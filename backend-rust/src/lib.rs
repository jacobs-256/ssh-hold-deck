mod backup;
mod channels;
mod crypto;
mod host_keys;
mod jumpserver;
mod store;
mod system;
mod terminal;

use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::any,
    Json, Router,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::future::IntoFuture;
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicU16, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{broadcast, watch};

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
pub struct Error {
    pub status: u16,
    pub message: String,
    pub extra: Value,
}
impl Error {
    pub fn bad(message: impl Into<String>) -> Self {
        Self::status(400, message)
    }
    pub fn status(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            extra: json!({}),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for Error {}
macro_rules! error_from {($($t:ty),*)=>{$(impl From<$t> for Error{fn from(error:$t)->Self{Self::bad(error.to_string())}})*};}
error_from!(
    std::io::Error,
    rusqlite::Error,
    serde_json::Error,
    reqwest::Error
);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let mut value = self.extra;
        value["error"] = json!(self.message);
        (
            StatusCode::from_u16(self.status).unwrap_or(StatusCode::BAD_REQUEST),
            Json(value),
        )
            .into_response()
    }
}
pub fn s<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 200
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
pub struct App {
    store: store::Store,
    root: PathBuf,
    hold: PathBuf,
    host: String,
    desktop: bool,
    port: AtomicU16,
    refresh: AtomicU64,
    attempts: Mutex<HashMap<String, (u32, i64)>>,
    operations: Mutex<HashSet<String>>,
    status_revision: AtomicU64,
    probes: Mutex<HashMap<String, i64>>,
    events: broadcast::Sender<()>,
    shutdown: watch::Sender<bool>,
    generation: watch::Sender<u64>,
    data_gate: tokio::sync::RwLock<()>,
    rebind: tokio::sync::mpsc::Sender<tokio::net::TcpListener>,
    grants: Mutex<HashMap<String, terminal::Grant>>,
    terminal_count: std::sync::atomic::AtomicUsize,
    host_keys: Mutex<HashMap<String, host_keys::Challenge>>,
    system_lock: tokio::sync::Mutex<()>,
    auth_lock: tokio::sync::Mutex<()>,
}
impl App {
    fn session(&self, headers: &HeaderMap) -> Option<String> {
        headers
            .get("cookie")?
            .to_str()
            .ok()?
            .split(';')
            .map(str::trim)
            .find_map(|p| p.strip_prefix("ssh_hold_session="))
            .and_then(|t| self.store.session(t))
    }
    fn origin(&self, headers: &HeaderMap, required: bool) -> bool {
        let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) else {
            return false;
        };
        if host
            .chars()
            .any(|c| c.is_whitespace() || "/@\\?#".contains(c))
        {
            return false;
        }
        let Ok(url) = url::Url::parse(&format!("http://{host}")) else {
            return false;
        };
        if url.port_or_known_default() != Some(self.port.load(Ordering::Relaxed)) {
            return false;
        }
        let hostname = hostname::get()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let local = url
            .host_str()
            .unwrap_or("")
            .trim_matches(['[', ']'])
            .to_lowercase();
        let allowed = ["localhost", "127.0.0.1", "::1", &hostname].contains(&local.as_str())
            || if_addrs::get_if_addrs()
                .unwrap_or_default()
                .iter()
                .any(|a| a.ip().to_string() == local);
        allowed
            && headers
                .get("origin")
                .map(|v| {
                    v.to_str().ok().is_some_and(|o| {
                        o.eq_ignore_ascii_case(&url.origin().ascii_serialization())
                    })
                })
                .unwrap_or(!required)
    }
    fn limit(&self, ip: &str) -> Result<()> {
        let mut map = self.attempts.lock().unwrap();
        map.retain(|_, v| v.1 > now());
        let entry = map.entry(ip.into()).or_insert((0, now() + 60000));
        if entry.0 >= 5 {
            return Err(Error::status(429, "密码错误次数过多，请稍后再试"));
        }
        entry.0 += 1;
        Ok(())
    }
    async fn confirm(&self, headers: &HeaderMap, password: &str, ip: &str) -> Result<()> {
        let _lock = self.auth_lock.lock().await;
        let owner = self
            .session(headers)
            .ok_or_else(|| Error::status(401, "请先登录"))?;
        self.limit(ip)?;
        let record = self.store.record()?;
        if !crypto::verify(password.into(), record.clone()).await? {
            return Err(Error::status(403, "密码错误"));
        }
        if self.session(headers) != Some(owner) || self.store.record()? != record {
            return Err(Error::status(401, "登录状态已失效"));
        }
        self.attempts.lock().unwrap().remove(ip);
        Ok(())
    }
    fn publish(&self) {
        let _ = self.events.send(());
    }
}
fn cookie(token: &str) -> String {
    format!(
        "ssh_hold_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}",
        if token.is_empty() { 0 } else { 43200 }
    )
}
fn ok(value: Value) -> Response {
    Json(value).into_response()
}
fn with_cookie(value: Value, token: &str) -> Response {
    let mut response = ok(value);
    response
        .headers_mut()
        .insert("set-cookie", cookie(token).parse().unwrap());
    response
}
fn password_check(value: &Value) -> Result<String> {
    let password = s(value, "password");
    if !(8..=256).contains(&password.encode_utf16().count()) {
        return Err(Error::bad("密码长度须为 8–256 个字符"));
    }
    Ok(password.into())
}

async fn auth_api(
    app: &Arc<App>,
    headers: &HeaderMap,
    path: &str,
    method: &Method,
    body: &Value,
    ip: &str,
) -> Result<Response> {
    let _gate = app
        .data_gate
        .try_read()
        .map_err(|_| Error::status(409, "备份正在恢复"))?;
    if path == "/api/auth/status" && *method == Method::GET {
        return Ok(ok(
            json!({"configured":!app.store.record()?.is_null(),"authenticated":app.session(headers).is_some()}),
        ));
    }
    if *method != Method::POST {
        return Err(Error::status(405, "Method not allowed"));
    }
    // Keep verification and session issuance ordered with password changes and logout.
    let _lock = app.auth_lock.lock().await;
    match path {
        "/api/auth/setup" => {
            if !app.store.record()?.is_null() {
                return Err(Error::status(409, "登录密码已设置，请使用密码登录"));
            }
            let password = password_check(body)?;
            if password != s(body, "confirmPassword") {
                return Err(Error::bad("两次输入的密码不一致"));
            }
            let record = crypto::hash(password).await?;
            let count = app.store.db.lock().unwrap().execute(
                "INSERT OR IGNORE INTO settings(key,value) VALUES('login_password',?)",
                [record.to_string()],
            )?;
            if count == 0 {
                return Err(Error::status(409, "登录密码已设置"));
            }
            Ok(with_cookie(json!({"ok":true}), &app.store.issue()?))
        }
        "/api/auth/login" => {
            app.limit(ip)?;
            let record = app.store.record()?;
            if record.is_null() {
                return Err(Error::status(409, "请先设置登录密码"));
            }
            if !crypto::verify(s(body, "password").into(), record.clone()).await? {
                return Err(Error::status(401, "密码错误"));
            }
            if app.store.record()? != record {
                return Err(Error::status(401, "密码已修改，请重新登录"));
            }
            app.attempts.lock().unwrap().remove(ip);
            if let Some(owner) = app.session(headers) {
                app.store
                    .db
                    .lock()
                    .unwrap()
                    .execute("DELETE FROM web_sessions WHERE token_hash=?", [owner])?;
            }
            Ok(with_cookie(json!({"ok":true}), &app.store.issue()?))
        }
        "/api/auth/logout" => {
            if let Some(owner) = app.session(headers) {
                app.store
                    .db
                    .lock()
                    .unwrap()
                    .execute("DELETE FROM web_sessions WHERE token_hash=?", [owner])?;
            }
            app.publish();
            Ok(with_cookie(json!({"ok":true}), ""))
        }
        "/api/auth/password" => {
            let owner = app
                .session(headers)
                .ok_or_else(|| Error::status(401, "请先登录"))?;
            let password = password_check(body)?;
            app.limit(ip)?;
            let record = app.store.record()?;
            let replacement = crypto::hash(password).await?;
            if !app.store.valid_session(&owner) || app.store.record()? != record {
                return Err(Error::status(401, "登录状态已失效"));
            }
            {
                let mut db = app.store.db.lock().unwrap();
                let tx = db.transaction()?;
                tx.execute(
                    "UPDATE settings SET value=? WHERE key='login_password'",
                    [replacement.to_string()],
                )?;
                tx.execute("DELETE FROM web_sessions", [])?;
                tx.commit()?;
            }
            app.attempts.lock().unwrap().remove(ip);
            app.publish();
            Ok(with_cookie(json!({"ok":true}), &app.store.issue()?))
        }
        _ => Err(Error::status(404, "Not found")),
    }
}
async fn dispatch(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let result = handle(&app, peer, method, &uri, headers, body).await;
    let mut response = match result {
        Ok(v) => v,
        Err(e) => e.into_response(),
    };
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
}
async fn handle(
    app: &Arc<App>,
    peer: SocketAddr,
    method: Method,
    uri: &Uri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response> {
    let path = uri.path();
    let ip = peer.ip().to_string();
    let api = path.starts_with("/api/");
    if api && !app.origin(&headers, method != Method::GET) {
        return Err(Error::status(403, "请求来源无效"));
    }
    if bytes.len()
        > if path.starts_with("/api/settings/backup/") {
            20 * 1024 * 1024
        } else {
            1024 * 1024
        }
    {
        return Err(Error::status(413, "请求过大"));
    }
    let body: Value = if bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&bytes).map_err(|_| Error::bad("JSON 无效"))?
    };
    if ["/api/auth/status", "/api/auth/setup", "/api/auth/login"].contains(&path) {
        return auth_api(app, &headers, path, &method, &body, &ip).await;
    }
    if api && app.session(&headers).is_none() {
        return Err(Error {
            status: 401,
            message: "请先登录".into(),
            extra: json!({"setupRequired":app.store.record()?.is_null()}),
        });
    }
    if path.starts_with("/api/auth/") {
        return auth_api(app, &headers, path, &method, &body, &ip).await;
    }
    if path == "/api/channels/events" && method == Method::GET {
        let owner = app.session(&headers).unwrap();
        let rx = app.events.subscribe();
        let initial = app.channels()?;
        let app = app.clone();
        let stream = async_stream_channels(app, owner, initial, rx.resubscribe());
        return Ok(Sse::new(stream)
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response());
    }
    if path == "/api/channels" && method == Method::GET {
        return Ok(ok(json!({"channels":app.channels()?})));
    }
    if path == "/api/channels/refresh" && method == Method::POST {
        app.refresh_statuses().await?;
        return Ok(ok(json!({"channels":app.channels()?})));
    }
    if path == "/api/channels/reload" && method == Method::POST {
        let result = app.import_channels()?;
        app.publish();
        return Ok(ok(
            json!({"imported":result.0,"skipped":result.1,"channels":app.channels()?}),
        ));
    }
    let query: HashMap<String, String> =
        url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    if path.starts_with("/api/channels") {
        return channels::api(app, &headers, &ip, &method, path, &query, body).await;
    }
    if path.starts_with("/api/jumpservers") {
        return jump_api(app, &headers, &ip, &method, path, &query, body).await;
    }
    if let Some(name) = path.strip_prefix("/api/terminal/") {
        if method != Method::POST {
            return Err(Error::status(405, "Method not allowed"));
        }
        return Ok(ok(
            json!({"token":terminal::issue(app,&headers,name).await?}),
        ));
    }
    if path.starts_with("/api/settings/backup/") {
        return backup::api(app, &headers, path, &method, body).await;
    }
    if path == "/api/host-keys/trust" && method == Method::POST {
        host_keys::trust(app, s(&body, "token"), &app.session(&headers).unwrap()).await?;
        return Ok(ok(json!({"ok":true})));
    }
    if path.starts_with("/api/system/") || path.starts_with("/api/settings/") {
        return system::api(app, &headers, &method, path, &query, body).await;
    }
    static_file(app, path, &method).await
}
fn async_stream_channels(
    app: Arc<App>,
    owner: String,
    initial: Value,
    rx: broadcast::Receiver<()>,
) -> impl futures_util::Stream<Item = std::result::Result<Event, std::convert::Infallible>> {
    let initial = futures_util::stream::once(async move {
        Ok(Event::default()
            .event("channels")
            .data(initial.to_string())
            .retry(Duration::from_secs(3)))
    });
    let ticks =
        tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(Duration::from_secs(15)))
            .map(|_| ());
    let updates = tokio_stream::wrappers::BroadcastStream::new(rx).map(|_| ());
    let output = app.clone();
    let mut generation = app.generation.subscribe();
    let mut shutdown = app.shutdown.subscribe();
    let events = futures_util::stream::select(ticks, updates)
        .take_while(move |_| futures_util::future::ready(app.store.valid_session(&owner)))
        .take_until(async move {
            tokio::select! {_=generation.changed()=>(),_=shutdown.changed()=>()}
        });
    // The session is checked for every event as well as every heartbeat.
    initial.chain(events.map(move |_| {
        Ok(Event::default()
            .event("channels")
            .data(output.channels().unwrap_or(json!([])).to_string()))
    }))
}
async fn static_file(app: &App, path: &str, method: &Method) -> Result<Response> {
    if *method != Method::GET {
        return Err(Error::status(405, "Method not allowed"));
    }
    let decoded = percent_decode_path(path)?;
    if decoded.split('/').any(|p| p == ".." || p.contains('\\')) {
        return Err(Error::status(404, "Not found"));
    }
    let file = app.root.join(if decoded == "/" {
        "index.html"
    } else {
        decoded.trim_start_matches('/')
    });
    let root = tokio::fs::canonicalize(&app.root).await?;
    let file = tokio::fs::canonicalize(file)
        .await
        .map_err(|_| Error::status(404, "Not found"))?;
    if !file.starts_with(root) {
        return Err(Error::status(404, "Not found"));
    }
    let content = tokio::fs::read(&file)
        .await
        .map_err(|_| Error::status(404, "Not found"))?;
    let kind = match file.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    Ok(([("content-type", kind)], content).into_response())
}
fn percent_decode_path(path: &str) -> Result<String> {
    let url =
        url::Url::parse(&format!("http://localhost{path}")).map_err(|_| Error::bad("路径无效"))?;
    Ok(url.path().to_owned())
}

async fn jump_api(
    app: &Arc<App>,
    headers: &HeaderMap,
    ip: &str,
    method: &Method,
    path: &str,
    query: &HashMap<String, String>,
    body: Value,
) -> Result<Response> {
    let _gate = app
        .data_gate
        .try_read()
        .map_err(|_| Error::status(409, "备份正在恢复"))?;
    let pieces: Vec<_> = path.trim_matches('/').split('/').collect();
    let id = pieces.get(2).copied().unwrap_or("");
    let _settings_lock = if (id.is_empty() && *method == Method::POST)
        || (id == "enabled" && *method == Method::POST)
        || *method == Method::PUT
        || *method == Method::DELETE
    {
        Some(app.system_lock.lock().await)
    } else {
        None
    };
    if id.is_empty() {
        if *method == Method::GET {
            return Ok(ok(
                json!({"servers":app.store.servers()?.iter().map(jumpserver::public).collect::<Vec<_>>(),"enabled":jumpserver::enabled(&app.store)?}),
            ));
        }
        if *method == Method::POST {
            let server = jumpserver::normalize(&body, &Value::Null)?;
            let mut all = app.store.servers()?;
            all.push(server.clone());
            app.store.save_servers(all)?;
            return Ok((
                StatusCode::CREATED,
                Json(json!({"server":jumpserver::public(&server)})),
            )
                .into_response());
        }
    }
    if id == "enabled" && *method == Method::POST {
        let enabled = body["enabled"]
            .as_bool()
            .ok_or_else(|| Error::bad("JumpServer 启用状态无效"))?;
        if enabled && app.store.servers()?.is_empty() {
            return Err(Error::bad("请先配置 JumpServer"));
        }
        app.store
            .set("jumpserverEnabled", if enabled { "1" } else { "0" })?;
        return Ok(ok(json!({"enabled":jumpserver::enabled(&app.store)?})));
    }
    if ["test", "organizations"].contains(&id) && *method == Method::POST {
        let previous = if s(&body, "id").is_empty() {
            Value::Null
        } else {
            app.store.server(s(&body, "id"))?
        };
        let server = jumpserver::normalize(&body, &previous)?;
        if id == "organizations" {
            return Ok(ok(jumpserver::organizations(&server).await?));
        }
        let profile = jumpserver::api(&server, "/api/v1/users/profile/", "GET", None).await?;
        return Ok(ok(
            json!({"username":profile["username"],"assetCount":jumpserver::assets(&server,"",0,1).await?["count"]}),
        ));
    }
    let server = app.store.server(id)?;
    match pieces.get(3).copied() {
        Some("secret") if *method == Method::POST => {
            app.confirm(headers, s(&body, "password"), ip).await?;
            Ok(ok(json!({"keySecret":server["keySecret"]})))
        }
        Some("assets") if *method == Method::GET => {
            if let Some(asset) = pieces.get(4) {
                Ok(ok(json!({"asset":jumpserver::asset(&server,asset).await?})))
            } else {
                let offset = query
                    .get("offset")
                    .map(|o| o.parse::<u64>())
                    .transpose()
                    .map_err(|_| Error::bad("分页参数无效"))?
                    .unwrap_or(0);
                Ok(ok(jumpserver::assets(
                    &server,
                    query.get("search").map(String::as_str).unwrap_or(""),
                    offset,
                    30,
                )
                .await?))
            }
        }
        None if *method == Method::PUT => {
            let updated = jumpserver::normalize(&body, &server)?;
            let all = app
                .store
                .servers()?
                .into_iter()
                .map(|s| if s["id"] == id { updated.clone() } else { s })
                .collect();
            app.store.save_servers(all)?;
            Ok(ok(json!({"server":jumpserver::public(&updated)})))
        }
        None if *method == Method::DELETE => {
            if app
                .store
                .configs()?
                .iter()
                .any(|(_, c)| c["serverId"] == id)
            {
                return Err(Error::status(
                    409,
                    "该 JumpServer 仍被通道使用，请先修改或删除相关通道",
                ));
            }
            let remaining = app
                .store
                .servers()?
                .into_iter()
                .filter(|s| s["id"] != id)
                .collect::<Vec<_>>();
            let empty = remaining.is_empty();
            app.store.save_servers(remaining)?;
            if empty {
                app.store.set("jumpserverEnabled", "0")?;
            }
            Ok(ok(
                json!({"ok":true,"enabled":jumpserver::enabled(&app.store)?}),
            ))
        }
        _ => Err(Error::status(404, "Not found")),
    }
}

pub async fn run() -> Result<()> {
    let mut paths =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    for path in [
        home().join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ] {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if let Ok(path) = std::env::join_paths(paths) {
        std::env::set_var("PATH", path);
    }
    let project = std::env::current_dir()?;
    let root = std::env::var_os("SSH_HOLD_PUBLIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let prepared = project.join("desktop/backend/public");
            if prepared.is_dir() {
                prepared
            } else {
                project.join("public")
            }
        });
    let directory = std::env::var_os("SSH_HOLD_WEB_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project.join("data"));
    let store = store::Store::open(directory)?;
    let desktop = std::env::var("SSH_HOLD_DESKTOP").ok().as_deref() == Some("1");
    let saved: Value = serde_json::from_str(&store.setting("service")?.unwrap_or("{}".into()))?;
    let host = if desktop {
        "127.0.0.1".into()
    } else {
        std::env::var("HOST").unwrap_or("0.0.0.0".into())
    };
    let configured = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(
            saved["port"]
                .as_u64()
                .unwrap_or(if desktop { 0 } else { 8787 }) as u16,
        );
    let listener = bind(&host, configured, desktop || saved["autoSelect"] == true).await?;
    let port = listener.local_addr()?.port();
    let (events, _) = broadcast::channel(32);
    let (shutdown, _) = watch::channel(false);
    let (generation, _) = watch::channel(0);
    let (rebind, mut listeners) = tokio::sync::mpsc::channel(2);
    let refresh = store
        .setting("refreshSeconds")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    let app = Arc::new(App {
        store,
        root,
        hold: std::env::var_os("SSH_HOLD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".ssh/hold")),
        host,
        desktop,
        port: AtomicU16::new(port),
        refresh: AtomicU64::new(refresh),
        events,
        shutdown,
        generation,
        data_gate: tokio::sync::RwLock::new(()),
        attempts: Mutex::new(HashMap::new()),
        operations: Mutex::new(HashSet::new()),
        status_revision: AtomicU64::new(0),
        probes: Mutex::new(HashMap::new()),
        grants: Mutex::new(HashMap::new()),
        terminal_count: 0.into(),
        host_keys: Mutex::new(HashMap::new()),
        system_lock: tokio::sync::Mutex::new(()),
        auth_lock: tokio::sync::Mutex::new(()),
        rebind,
    });
    if app.store.setting("initialized")?.is_none() {
        let vault = app.hold.join(".web-vault");
        if vault.exists() {
            let values = app.store.unseal(&std::fs::read_to_string(vault)?)?;
            if let Some(values) = values.as_object() {
                for (name, config) in values {
                    app.store.save(name, config)?;
                }
            }
        }
        app.import_channels()?;
        app.store.set("initialized", "1")?;
    }
    let shutdown = app.shutdown.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        let _ = shutdown.send(true);
    });
    #[cfg(unix)]
    {
        let shutdown = app.shutdown.clone();
        tokio::spawn(async move {
            if let Ok(mut signal) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                signal.recv().await;
                let _ = shutdown.send(true);
            }
        });
    }
    if desktop {
        let shutdown = app.shutdown.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut b = [0; 1];
            while std::io::stdin().read(&mut b).unwrap_or(0) > 0 {}
            let _ = shutdown.send(true);
        });
    }
    let background = app.clone();
    tokio::spawn(async move {
        let _ = background.refresh_statuses().await;
        let mut ticks = tokio::time::interval(Duration::from_secs(1));
        let mut elapsed = 0;
        let mut stop = background.shutdown.subscribe();
        loop {
            tokio::select! {_=stop.changed()=>break,_=ticks.tick()=>{elapsed+=1;let seconds=background.refresh.load(Ordering::Relaxed);if seconds>0&&elapsed>=seconds{elapsed=0;let _=background.refresh_statuses().await;}}}
        }
    });
    let router = Router::new()
        .route("/terminal", axum::routing::get(terminal::upgrade))
        .fallback(any(dispatch))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
        .with_state(app.clone());
    let mut listener = listener;
    loop {
        report_ready(&app);
        let mut stop = app.shutdown.subscribe();
        let mut restart = app.shutdown.subscribe();
        let mut changed = app.generation.subscribe();
        let server = axum::serve(
            listener,
            router
                .clone()
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            tokio::select! {_=stop.changed()=>(),_=changed.changed()=>()}
        })
        .into_future();
        tokio::pin!(server);
        // Rebind listeners are prepared before acknowledging a port change.
        tokio::select! {_ = restart.changed()=>{let _=tokio::time::timeout(Duration::from_secs(5),&mut server).await;break;},Some(next)=listeners.recv()=>{app.generation.send_modify(|n|*n+=1);let _=tokio::time::timeout(Duration::from_secs(5),&mut server).await;listener=next;app.port.store(listener.local_addr()?.port(),Ordering::Relaxed);continue;},result=&mut server=>{result?;break;}}
    }
    Ok(())
}
pub(crate) async fn bind(host: &str, port: u16, auto: bool) -> Result<tokio::net::TcpListener> {
    match tokio::net::TcpListener::bind((host, port)).await {
        Ok(l) => Ok(l),
        Err(e) if auto && e.kind() == std::io::ErrorKind::AddrInUse => {
            Ok(tokio::net::TcpListener::bind((host, 0)).await?)
        }
        Err(e) => Err(e.into()),
    }
}
fn report_ready(app: &App) {
    println!(
        "SSH Hold Deck Rust: http://{}:{}",
        app.host,
        app.port.load(Ordering::Relaxed)
    );
    if app.desktop {
        println!(
            "SSH_HOLD_DESKTOP_READY {}",
            json!({"port":app.port.load(Ordering::Relaxed),"token":std::env::var("SSH_HOLD_DESKTOP_TOKEN").unwrap_or_default()})
        );
    }
}
