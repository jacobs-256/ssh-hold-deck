use crate::{crypto, Error, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Store {
    pub db: Mutex<Connection>,
    pub directory: PathBuf,
    key: [u8; 32],
    unreadable: Mutex<Vec<String>>,
}
pub fn private_dir(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)?;
    private_mode(path, 0o700)
}
pub fn private_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    }
    let _ = (path, mode);
    Ok(())
}
fn unseal_with(raw: &str, key: &[u8; 32]) -> Result<Value> {
    crypto::decrypt(&serde_json::from_str(raw)?, key)
}
fn rows(db: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = db.prepare("SELECT name,config FROM channels ORDER BY rowid")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn write_key(path: &Path, key: &[u8; 32]) -> Result<()> {
    std::fs::write(path, crypto::encode_key(key))?;
    private_mode(path, 0o600)
}
fn host_variants(host: &str) -> Vec<String> {
    let mut names = vec![host.to_string(), host.to_lowercase()];
    if !host.contains('.') {
        names.push(format!("{host}.local"));
    }
    names.sort();
    names.dedup();
    names
}
fn extra_legacy_keys(directory: &Path) -> Vec<[u8; 32]> {
    let mut sources = Vec::new();
    if let Ok(text) = std::fs::read_to_string(directory.join("legacy-identity.txt")) {
        sources.push(text);
    }
    if let Ok(text) = std::env::var("SSH_HOLD_LEGACY_IDENTITY") {
        sources.push(text);
    }
    let mut keys = Vec::new();
    for text in sources {
        for line in text.lines().flat_map(|line| line.split(',')) {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (user, host) = match line.split_once(':') {
                Some((user, host)) => (Some(user.trim()), host.trim()),
                None => (None, line),
            };
            if host.is_empty() {
                continue;
            }
            for name in host_variants(host) {
                keys.push(match user {
                    Some(user) if !user.is_empty() => crypto::legacy_key_for_identity(user, &name),
                    _ => crypto::legacy_key_for(&name),
                });
            }
        }
    }
    keys.sort();
    keys.dedup();
    keys
}
fn backup_key(directory: &Path, path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let backup = directory.join(format!("{}.unreadable-{stamp}", crypto::KEY_FILE));
    if std::fs::copy(path, &backup).is_ok() {
        let _ = private_mode(&backup, 0o600);
        eprintln!("backed up unreadable vault.key to {}", backup.display());
    }
}
/// The vault key used to live only in the hostname-derived value. Persisting it
/// keeps stored credentials readable when the machine's hostname changes, and
/// the legacy candidates let existing installations keep their data.
fn load_key(directory: &Path, stored: &[(String, String)]) -> Result<[u8; 32]> {
    let path = directory.join(crypto::KEY_FILE);
    let existing = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| crypto::parse_key(&text));
    if let Some(key) = existing {
        if stored.is_empty()
            || stored
                .iter()
                .any(|(_, raw)| unseal_with(raw, &key).is_ok())
        {
            return Ok(key);
        }
        eprintln!("vault.key cannot decrypt the existing records; trying legacy identities");
    } else if std::fs::metadata(&path).is_ok() {
        eprintln!("vault.key is invalid; selecting a key for the existing records");
    } else {
        eprintln!("vault.key not found; selecting a key for the existing records");
    }
    let adopted = if stored.is_empty() {
        None
    } else {
        let mut candidates = crypto::legacy_keys();
        candidates.extend(extra_legacy_keys(directory));
        candidates.sort();
        candidates.dedup();
        candidates
            .into_iter()
            .max_by_key(|key| {
                stored
                    .iter()
                    .filter(|(_, raw)| unseal_with(raw, key).is_ok())
                    .count()
            })
            .filter(|key| stored.iter().any(|(_, raw)| unseal_with(raw, key).is_ok()))
    };
    if let Some(key) = adopted {
        if existing.is_some() {
            backup_key(directory, &path);
        }
        write_key(&path, &key)?;
        eprintln!("adopted a legacy vault key for existing records");
        return Ok(key);
    }
    if let Some(key) = existing {
        eprintln!("no legacy key matched; keeping the existing vault.key");
        return Ok(key);
    }
    let key = crypto::random::<32>();
    write_key(&path, &key)?;
    Ok(key)
}
impl Store {
    pub fn open(directory: PathBuf) -> Result<Self> {
        eprintln!("SSH Hold Deck backend: opening data store {}", directory.display());
        private_dir(&directory)?;
        let file = directory.join("channels.sqlite");
        let db = Connection::open(&file)?;
        private_mode(&file, 0o600)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS channels(name TEXT PRIMARY KEY,config TEXT NOT NULL);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS channel_status(name TEXT PRIMARY KEY,snapshot TEXT NOT NULL);CREATE TABLE IF NOT EXISTS web_sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);")?;
        let stored = rows(&db)?;
        eprintln!("SSH Hold Deck backend: resolving vault key ({} records)", stored.len());
        let key = load_key(&directory, &stored)?;
        let unreadable = stored
            .iter()
            .filter(|(_, raw)| unseal_with(raw, &key).is_err())
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();
        eprintln!("SSH Hold Deck backend: vault ready, {} unreadable records", unreadable.len());
        let store = Self {
            db: Mutex::new(db),
            directory,
            key,
            unreadable: Mutex::new(unreadable),
        };
        for (name, config) in store.configs()? {
            if config["createdAt"].as_str().unwrap_or("").is_empty() {
                store.save(&name, &config)?;
            }
        }
        Ok(store)
    }
    /// Channels whose stored configuration cannot be decrypted with the current
    /// key. They are left in the database but skipped when listing so that a
    /// single damaged record cannot stop the service from starting.
    pub fn unreadable(&self) -> Vec<String> {
        self.unreadable.lock().unwrap().clone()
    }
    pub fn is_unreadable(&self, name: &str) -> bool {
        self.unreadable.lock().unwrap().iter().any(|entry| entry == name)
    }
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .lock()
            .unwrap()
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.db.lock().unwrap().execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
            [key, value],
        )?;
        Ok(())
    }
    pub fn seal(&self, value: &Value) -> Result<String> {
        Ok(crypto::encrypt(value, &self.key)?.to_string())
    }
    pub fn unseal(&self, raw: &str) -> Result<Value> {
        crypto::decrypt(&serde_json::from_str(raw)?, &self.key)
    }
    pub fn configs(&self) -> Result<Vec<(String, Value)>> {
        let raw = self.raw_configs()?;
        let mut readable = vec![];
        let mut unreadable = vec![];
        for (name, raw) in raw {
            match unseal_with(&raw, &self.key) {
                Ok(value) => readable.push((name, value)),
                Err(_) => unreadable.push(name),
            }
        }
        *self.unreadable.lock().unwrap() = unreadable;
        Ok(readable)
    }
    pub fn raw_configs(&self) -> Result<Vec<(String, String)>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT name,config FROM channels ORDER BY rowid")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
    pub fn config(&self, name: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self
            .db
            .lock()
            .unwrap()
            .query_row("SELECT config FROM channels WHERE name=?", [name], |r| {
                r.get(0)
            })
            .optional()?;
        let Some(raw) = raw else { return Ok(None) };
        match unseal_with(&raw, &self.key) {
            Ok(value) => Ok(Some(value)),
            // Unreadable records behave as missing so the channel can be deleted
            // or recreated instead of trapping the name forever.
            Err(error) if self.is_unreadable(name) => {
                eprintln!("ignoring unreadable channel record {name}: {error}");
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }
    pub fn save(&self, name: &str, value: &Value) -> Result<()> {
        let previous = self.config(name)?.unwrap_or(json!({}));
        let snapshot = self.status(name)?;
        let mut value = value.clone();
        let created = [
            &previous["createdAt"],
            &value["createdAt"],
            &previous["started"],
            &value["started"],
            &snapshot["started"],
        ]
        .into_iter()
        .find_map(|value| value.as_str().filter(|text| !text.is_empty()));
        value["createdAt"] = match created {
            Some(created) => json!(created),
            None => json!(self.db.lock().unwrap().query_row(
                "SELECT strftime('%Y-%m-%d %H:%M:%S','now','localtime')",
                [],
                |row| row.get::<_, String>(0)
            )?),
        };
        let raw = self.seal(&value)?;
        self.db.lock().unwrap().execute(
            "INSERT OR REPLACE INTO channels(name,config) VALUES(?,?)",
            [name, &raw],
        )?;
        Ok(())
    }
    pub fn rename(&self, old: &str, new: &str, config: &Value) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        if db
            .query_row("SELECT 1 FROM channels WHERE name=?", [new], |_| Ok(()))
            .optional()?
            .is_some()
        {
            return Err(Error::bad("通道名称已存在，请使用其他名称"));
        }
        let rows = {
            let mut stmt = db.prepare("SELECT name,config FROM channels ORDER BY rowid")?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let mut updates = vec![];
        for (name, raw) in rows {
            if name == old {
                continue;
            }
            let Ok(mut value) = unseal_with(&raw, &self.key) else {
                continue;
            };
            if value["jump"].as_str() == Some(old) {
                value["jump"] = json!(new);
                updates.push((name, self.seal(&value)?));
            }
        }
        let sealed = self.seal(config)?;
        let tx = db.transaction()?;
        tx.execute("DELETE FROM channels WHERE name=?", [old])?;
        tx.execute(
            "INSERT INTO channels(name,config) VALUES(?,?)",
            rusqlite::params![new, sealed],
        )?;
        for (name, raw) in updates {
            tx.execute(
                "UPDATE channels SET config=? WHERE name=?",
                rusqlite::params![raw, name],
            )?;
        }
        tx.execute("DELETE FROM channel_status WHERE name=?", [old])?;
        tx.execute("DELETE FROM channel_status WHERE name=?", [new])?;
        tx.commit()?;
        Ok(())
    }
    pub fn compare_save(&self, name: &str, previous: &Value, value: &Value) -> Result<bool> {
        let raw = self.seal(value)?;
        let db = self.db.lock().unwrap();
        let existing: Option<String> = db
            .query_row("SELECT config FROM channels WHERE name=?", [name], |r| {
                r.get(0)
            })
            .optional()?;
        if existing.and_then(|s| unseal_with(&s, &self.key).ok()).as_ref() != Some(previous) {
            return Ok(false);
        }
        db.execute(
            "UPDATE channels SET config=? WHERE name=?",
            [raw.as_str(), name],
        )?;
        Ok(true)
    }
    pub fn servers(&self) -> Result<Vec<Value>> {
        let Some(raw) = self.setting("jumpservers")? else {
            return Ok(vec![]);
        };
        let value = match unseal_with(&raw, &self.key) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("ignoring unreadable JumpServer settings: {error}");
                return Ok(vec![]);
            }
        };
        Ok(value["servers"].as_array().cloned().unwrap_or_default())
    }
    pub fn save_servers(&self, servers: Vec<Value>) -> Result<()> {
        self.set("jumpservers", &self.seal(&json!({"servers":servers}))?)
    }
    pub fn server(&self, id: &str) -> Result<Value> {
        self.servers()?
            .into_iter()
            .find(|s| s["id"] == id)
            .ok_or_else(|| Error::bad("JumpServer 配置不存在"))
    }
    pub fn snapshot(&self, name: &str, value: &Value) -> Result<()> {
        self.db.lock().unwrap().execute(
            "INSERT OR REPLACE INTO channel_status(name,snapshot) VALUES(?,?)",
            [name, &value.to_string()],
        )?;
        Ok(())
    }
    pub fn status(&self, name: &str) -> Result<Value> {
        let raw: Option<String> = self
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT snapshot FROM channel_status WHERE name=?",
                [name],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(json!({"status":"未知","keepalive":"未知"})))
    }
    pub fn record(&self) -> Result<Value> {
        Ok(self
            .setting("login_password")?
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or(Value::Null))
    }
    pub fn session(&self, token: &str) -> Option<String> {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let hash = crypto::digest(token);
        self.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT token_hash FROM web_sessions WHERE token_hash=? AND expires>?",
                rusqlite::params![hash, crate::now()],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }
    pub fn valid_session(&self, hash: &str) -> bool {
        self.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT 1 FROM web_sessions WHERE token_hash=? AND expires>?",
                rusqlite::params![hash, crate::now()],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
    }
    pub fn issue(&self) -> Result<String> {
        let token = hex::encode(crypto::random::<32>());
        let db = self.db.lock().unwrap();
        db.execute("DELETE FROM web_sessions WHERE expires<=?", [crate::now()])?;
        db.execute(
            "INSERT INTO web_sessions(token_hash,expires) VALUES(?,?)",
            rusqlite::params![crypto::digest(&token), crate::now() + 43_200_000],
        )?;
        Ok(token)
    }
}
