use crate::{channels::execute, now, s, system::private_write, App, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
pub struct Challenge {
    owner: String,
    expires: i64,
    file: PathBuf,
    original: String,
    lookup: String,
    key: String,
}
fn fingerprint(key: &str) -> Option<String> {
    Some(format!(
        "SHA256:{}",
        STANDARD
            .encode(Sha256::digest(STANDARD.decode(key).ok()?))
            .trim_end_matches('=')
    ))
}
pub async fn challenge(
    app: &App,
    error: &str,
    config: &Value,
    proxy: &[String],
    owner: &str,
) -> Result<Option<Value>> {
    if !error.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return Ok(None);
    }
    let Some(offered) = regex::Regex::new(r"(?i)fingerprint[^\n]*\n?\s*(SHA256:[A-Za-z0-9+/]+)")
        .unwrap()
        .captures(error)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_owned())
    else {
        return Ok(None);
    };
    let file = match std::fs::canonicalize(crate::home().join(".ssh/known_hosts")) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let original = std::fs::read_to_string(&file)?;
    let target = s(config, "target");
    let host = target.rsplit('@').next().unwrap_or("");
    let port = config["port"].as_u64().unwrap_or(22);
    let lookup = if port == 22 {
        host.into()
    } else {
        format!("[{host}]:{port}")
    };
    let directory = std::env::temp_dir().join(format!("deck-host-key-{}", uuid::Uuid::new_v4()));
    crate::store::private_dir(&directory)?;
    let captured = directory.join("known_hosts");
    let mut args = vec![
        "-F".into(),
        "/dev/null".into(),
        "-o".into(),
        format!("UserKnownHostsFile={}", captured.display()),
        "-o".into(),
        "GlobalKnownHostsFile=/dev/null".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "PreferredAuthentications=none".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "ConnectionAttempts=1".into(),
    ];
    args.extend_from_slice(proxy);
    args.extend(["-p".into(), port.to_string(), target.into(), "exit".into()]);
    let _ = execute("ssh", &args, "", &app.hold, 15).await;
    let content = std::fs::read_to_string(&captured).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&directory);
    let Some(key) = content
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>())
        .find(|p| p.len() == 3 && fingerprint(p[2]).as_deref() == Some(&offered))
    else {
        return Ok(None);
    };
    let found = execute(
        "ssh-keygen",
        &[
            "-F".into(),
            lookup.clone(),
            "-f".into(),
            file.to_string_lossy().into(),
        ],
        "",
        &app.hold,
        5,
    )
    .await?;
    let old: Vec<_> = found
        .stdout
        .lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| fingerprint(l.split_whitespace().nth(2)?))
        .collect();
    if old.is_empty() {
        return Ok(None);
    }
    let token = uuid::Uuid::new_v4().to_string();
    let mut pending = app.host_keys.lock().unwrap();
    pending.retain(|_, v| v.expires > now());
    if pending.len() >= 100 {
        return Ok(None);
    }
    pending.insert(
        token.clone(),
        Challenge {
            owner: owner.into(),
            expires: now() + 120000,
            file,
            original,
            lookup: lookup.clone(),
            key: format!("{} {} {}", lookup, key[1], key[2]),
        },
    );
    Ok(Some(
        json!({"token":token,"host":lookup,"fingerprint":offered,"oldFingerprints":old}),
    ))
}
pub async fn trust(app: &App, token: &str, owner: &str) -> Result<()> {
    let _lock = app.system_lock.lock().await;
    let item = {
        let mut pending = app.host_keys.lock().unwrap();
        if !pending
            .get(token)
            .is_some_and(|v| v.owner == owner && v.expires > now())
        {
            return Err(Error::bad("指纹确认已过期，请重新连接"));
        }
        pending.remove(token).unwrap()
    };
    if std::fs::read_to_string(&item.file)? != item.original {
        return Err(Error::bad("主机指纹文件已变化，请重新连接后确认"));
    }
    let temporary = item
        .file
        .with_extension(format!("deck-{}", uuid::Uuid::new_v4()));
    private_write(&temporary, item.original.as_bytes())?;
    let result = async {
        let out = execute(
            "ssh-keygen",
            &[
                "-R".into(),
                item.lookup,
                "-f".into(),
                temporary.to_string_lossy().into(),
            ],
            "",
            &app.hold,
            5,
        )
        .await?;
        if !out.ok {
            return Err(Error::bad("无法更新主机指纹"));
        }
        let cleaned = std::fs::read_to_string(&temporary)?;
        std::fs::write(
            &temporary,
            format!("{}\n{}\n", cleaned.trim_end(), item.key),
        )?;
        private_write(
            &item
                .file
                .with_extension(format!("deck-backup-{}", uuid::Uuid::new_v4())),
            item.original.as_bytes(),
        )?;
        if std::fs::read_to_string(&item.file)? != item.original {
            return Err(Error::bad("主机指纹文件已变化，请重新连接后确认"));
        }
        if !app.store.valid_session(owner) {
            return Err(Error::status(401, "登录状态已失效"));
        }
        std::fs::rename(&temporary, item.file)?;
        Ok(())
    }
    .await;
    let _ = std::fs::remove_file(&temporary);
    let _ = std::fs::remove_file(format!("{}.old", temporary.display()));
    result
}
