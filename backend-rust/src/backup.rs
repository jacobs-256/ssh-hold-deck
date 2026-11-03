use crate::{crypto, now, ok, s, store, App, Error, Result};
use axum::{
    http::{HeaderMap, Method},
    response::Response,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::Arc;
fn password(body: &Value) -> Result<&str> {
    let p = s(body, "password");
    if !(8..=256).contains(&p.encode_utf16().count()) {
        return Err(Error::bad("备份密码须为 8–256 个字符"));
    }
    Ok(p)
}
fn validate(payload: &Value) -> Result<()> {
    let channels = payload["channels"]
        .as_array()
        .ok_or_else(|| Error::bad("备份文件格式无效"))?;
    let settings = payload["settings"]
        .as_array()
        .ok_or_else(|| Error::bad("备份文件格式无效"))?;
    if payload["version"] != 1 || channels.len() > 10000 || settings.len() > 100 {
        return Err(Error::bad("备份文件格式无效"));
    }
    let mut names = std::collections::HashSet::new();
    for item in channels {
        let c = &item["config"];
        if !crate::valid_name(s(item, "name"))
            || !names.insert(s(item, "name"))
            || !c.is_object()
            || c["port"].as_u64().is_none_or(|p| !(1..=65535).contains(&p))
            || !s(c, "target").contains('@')
            || !["password", "key", "jumpserver"].contains(&s(c, "auth"))
            || (!s(c, "source").is_empty() && !["manual", "jumpserver"].contains(&s(c, "source")))
        {
            return Err(Error::bad("备份通道配置无效"));
        }
        if c["auth"] == "key"
            && (s(item, "identityContent").len() > 65536
                || !s(item, "identityContent").contains("PRIVATE KEY-----"))
        {
            return Err(Error::bad("备份通道私钥无效"));
        }
    }
    let mut keys = std::collections::HashSet::new();
    for item in settings {
        let key = s(item, "key");
        if ![
            "initialized",
            "login_password",
            "jumpservers",
            "refreshSeconds",
            "service",
        ]
        .contains(&key)
            || !keys.insert(key)
            || !item["value"].is_string()
        {
            return Err(Error::bad("备份设置无效"));
        }
        let v: Value = serde_json::from_str(s(item, "value"))?;
        match key {
            "login_password" => {
                if s(&v, "salt").len() != 64
                    || s(&v, "hash").len() != 128
                    || hex::decode(s(&v, "salt")).is_err()
                    || hex::decode(s(&v, "hash")).is_err()
                {
                    return Err(Error::bad("备份登录配置无效"));
                }
            }
            "jumpservers" => {
                let servers = v["servers"]
                    .as_array()
                    .ok_or_else(|| Error::bad("备份设置无效"))?;
                let mut ids = std::collections::HashSet::new();
                for server in servers {
                    if !ids.insert(s(server, "id")) || s(server, "id").is_empty() {
                        return Err(Error::bad("备份设置无效"));
                    }
                    crate::jumpserver::normalize(server, server)?;
                }
            }
            "refreshSeconds" => {
                let Some(n) = v.as_u64() else {
                    return Err(Error::bad("备份设置无效"));
                };
                if n != 0 && !(5..=3600).contains(&n) {
                    return Err(Error::bad("备份设置无效"));
                }
            }
            "service" => {
                let Some(port) = v["port"].as_u64() else {
                    return Err(Error::bad("备份设置无效"));
                };
                if port != 0 && !(1024..=65535).contains(&port) || !v["autoSelect"].is_boolean() {
                    return Err(Error::bad("备份设置无效"));
                }
            }
            _ => (),
        }
    }
    if !keys.contains("login_password") {
        return Err(Error::bad("备份缺少登录配置"));
    }
    let preferences = payload["preferences"]
        .as_object()
        .ok_or_else(|| Error::bad("备份界面配置无效"))?;
    for (key, value) in preferences {
        let allowed: &[&str] = match key.as_str() {
            "ssh-hold-language" => &["auto", "zh-CN", "en"],
            "ssh-hold-theme" => &["auto", "light", "dark"],
            "ssh-hold-text-size" => &["small", "default", "large", "xlarge"],
            "channelPageSize" => &["10", "20", "50", "100"],
            _ => return Err(Error::bad("备份界面配置无效")),
        };
        if !allowed.contains(&value.as_str().unwrap_or("")) {
            return Err(Error::bad("备份界面配置无效"));
        }
    }
    if !payload["desktop"].is_null() {
        let d = &payload["desktop"];
        if !["ask", "tray", "quit"].contains(&s(d, "closeBehavior"))
            || !d["trayEnabled"].is_boolean()
            || d["trayEnabled"] == false && d["closeBehavior"] == "tray"
        {
            return Err(Error::bad("备份桌面配置无效"));
        }
    }
    Ok(())
}
pub async fn api(
    app: &Arc<App>,
    headers: &HeaderMap,
    path: &str,
    method: &Method,
    body: Value,
) -> Result<Response> {
    if *method != Method::POST {
        return Err(Error::status(405, "Method not allowed"));
    }
    let owner = app.session(headers).unwrap();
    if path.ends_with("/export") {
        let _gate = app
            .data_gate
            .try_read()
            .map_err(|_| Error::status(409, "备份正在恢复"))?;
        let mut channels = vec![];
        for (name, config) in app.store.configs()? {
            let mut item = json!({"name":name,"config":config});
            if item["config"]["auth"] == "key" {
                item["identityContent"] =
                    json!(std::fs::read_to_string(s(&item["config"], "identity"))
                        .map_err(|_| Error::bad("无法读取通道私钥，备份已取消"))?);
            }
            channels.push(item);
        }
        let mut settings = vec![];
        {
            let db = app.store.db.lock().unwrap();
            let mut stmt = db.prepare("SELECT key,value FROM settings")?;
            let entries = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for entry in entries {
                let (key, value) = entry?;
                settings.push(json!({"key":key,"value":if key=="jumpservers"{app.store.unseal(&value)?.to_string()}else{value}}));
            }
        }
        let payload = json!({"version":1,"createdAt":now(),"channels":channels,"settings":settings,"preferences":body.get("preferences").cloned().unwrap_or(json!({})),"desktop":body["desktop"]});
        validate(&payload)?;
        let p = password(&body)?.to_owned();
        let salt = crypto::random::<32>();
        let payload = tokio::task::spawn_blocking(move || -> Result<Value> {
            let key: [u8; 32] = crypto::derive(&p, &salt, 32)?.try_into().unwrap();
            let mut envelope = crypto::encrypt(&payload, &key)?;
            envelope["format"] = json!("ssh-hold-deck-backup");
            envelope["version"] = json!(1);
            envelope["salt"] = json!(STANDARD.encode(salt));
            Ok(envelope)
        })
        .await
        .map_err(|_| Error::bad("备份加密失败"))??;
        if !app.store.valid_session(&owner) {
            return Err(Error::status(401, "请先登录"));
        }
        if payload.to_string().len() > 20 * 1024 * 1024 - 2048 {
            return Err(Error::status(413, "备份文件过大"));
        }
        let mut response = ok(payload);
        response.headers_mut().insert(
            "content-disposition",
            "attachment; filename=\"ssh-hold-deck-backup.json\""
                .parse()
                .unwrap(),
        );
        return Ok(response);
    }
    if path.ends_with("/import") {
        if body["confirmed"] != true {
            return Err(Error::bad("请确认覆盖现有配置"));
        }
        if !app.operations.lock().unwrap().is_empty() {
            return Err(Error::status(409, "存在进行中的操作，请稍后重试"));
        }
        let envelope = body["backup"].clone();
        if envelope["format"] != "ssh-hold-deck-backup" || envelope["version"] != 1 {
            return Err(Error::bad("备份文件格式无效"));
        }
        let salt = crypto::decode(&envelope["salt"])?;
        if salt.len() != 32 {
            return Err(Error::bad("备份文件格式无效"));
        }
        let p = password(&body)?.to_owned();
        let mut payload = tokio::task::spawn_blocking(move || -> Result<Value> {
            let key: [u8; 32] = crypto::derive(&p, &salt, 32)?.try_into().unwrap();
            crypto::decrypt(&envelope, &key).map_err(|_| Error::bad("备份密码错误或文件已损坏"))
        })
        .await
        .map_err(|_| Error::bad("备份解密失败"))??;
        validate(&payload)?;
        let _lock = app.system_lock.lock().await;
        let _gate = app
            .data_gate
            .try_write()
            .map_err(|_| Error::status(409, "存在进行中的操作，请稍后重试"))?;
        if !app.operations.lock().unwrap().is_empty() || !app.store.valid_session(&owner) {
            return Err(Error::status(409, "存在进行中的操作或登录已过期"));
        }
        let mut files = vec![];
        let imported = (|| -> Result<()> {
            for item in payload["channels"].as_array_mut().unwrap() {
                if item["config"]["auth"] == "key" {
                    let mut key = json!({"auth":"key","identityContent":item["identityContent"]});
                    app.identity(&mut key)?;
                    files.push(std::path::PathBuf::from(s(&key, "identity")));
                    item["config"]["identity"] = key["identity"].clone();
                }
            }
            let mut db = app.store.db.lock().unwrap();
            let tx = db.transaction()?;
            tx.execute_batch("DELETE FROM channels;DELETE FROM channel_status;DELETE FROM settings;DELETE FROM web_sessions;")?;
            for item in payload["channels"].as_array().unwrap() {
                tx.execute(
                    "INSERT INTO channels(name,config) VALUES(?,?)",
                    [s(item, "name"), &app.store.seal(&item["config"])?],
                )?;
            }
            for item in payload["settings"].as_array().unwrap() {
                let value = if item["key"] == "jumpservers" {
                    app.store.seal(&serde_json::from_str(s(item, "value"))?)?
                } else {
                    s(item, "value").into()
                };
                tx.execute(
                    "INSERT INTO settings(key,value) VALUES(?,?)",
                    [s(item, "key"), &value],
                )?;
            }
            tx.execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('initialized','1')",
                [],
            )?;
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = imported {
            for file in files {
                let _ = std::fs::remove_file(file);
            }
            return Err(error);
        }
        app.refresh.store(
            app.store
                .setting("refreshSeconds")?
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            std::sync::atomic::Ordering::Relaxed,
        );
        app.publish();
        let _ = store::private_mode(&app.store.directory.join("channels.sqlite"), 0o600);
        return Ok(ok(
            json!({"ok":true,"preferences":payload["preferences"],"desktop":payload["desktop"],"channels":payload["channels"].as_array().unwrap().len(),"restartRequired":true}),
        ));
    }
    Err(Error::status(404, "Not found"))
}
