use crate::{jumpserver, now, ok, s, store, valid_name, App, Error, Result};
use axum::{
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    process::Stdio,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}
pub async fn execute(
    program: &str,
    args: &[String],
    input: &str,
    hold: &std::path::Path,
    seconds: u64,
) -> Result<Output> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("SSH_HOLD_DIR", hold)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd
        .spawn()
        .map_err(|_| Error::bad(format!("无法启动 {program}，请检查本机安装")))?;
    let pid = child.id();
    let mut stdin = child.stdin.take().unwrap();
    let input = input.as_bytes().to_vec();
    tokio::spawn(async move {
        let _ = stdin.write_all(&input).await;
    });
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let mut out = tokio::spawn(async move {
        let mut data = Vec::new();
        let mut block = [0; 4096];
        while let Ok(n) = stdout.read(&mut block).await {
            if n == 0 {
                break;
            }
            data.extend_from_slice(&block[..n]);
            if data.len() > 1024 * 1024 {
                data.drain(..data.len() - 1024 * 1024);
            }
        }
        String::from_utf8_lossy(&data).into_owned()
    });
    let mut err = tokio::spawn(async move {
        let mut data = Vec::new();
        let mut block = [0; 4096];
        while let Ok(n) = stderr.read(&mut block).await {
            if n == 0 {
                break;
            }
            data.extend_from_slice(&block[..n]);
            if data.len() > 65536 {
                data.drain(..data.len() - 65536);
            }
        }
        String::from_utf8_lossy(&data).into_owned()
    });
    let completed = tokio::time::timeout(Duration::from_secs(seconds), async {
        let status = child.wait().await?;
        let (stdout, stderr) = tokio::join!(&mut out, &mut err);
        Ok::<_, std::io::Error>(Output {
            ok: status.success(),
            stdout: stdout.unwrap_or_default(),
            stderr: stderr.unwrap_or_default(),
        })
    })
    .await;
    if completed.is_err() {
        #[cfg(unix)]
        if let Some(pid) = pid {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        let _ = child.kill().await;
        out.abort();
        err.abort();
        return Err(Error::bad("SSH 连接超时，请检查网关地址、端口和访问策略"));
    }
    Ok(completed.unwrap()?)
}
pub fn parse_list(text: &str) -> Vec<Value> {
    let mut rows: Vec<Value> = vec![];
    for line in text.lines() {
        if line.starts_with("  ") && !line.starts_with("   ") && !line.trim().is_empty() {
            rows.push(json!({"name":line.trim()}));
        } else if line.starts_with("    ") {
            if let Some((key, value)) = line.trim().split_once(':') {
                let key = match key {
                    "目标" => "target",
                    "开通" => "started",
                    "通道" => "status",
                    "保活" => "keepalive",
                    "远端" => "remote",
                    _ => continue,
                };
                if let Some(row) = rows.last_mut() {
                    row[key] = json!(value.trim());
                }
            }
        }
    }
    rows
}
pub fn availability(c: &Value) -> Value {
    let reason = if c["source"] == "jumpserver" {
        if ["serverId", "assetId", "account"]
            .iter()
            .any(|k| s(c, k).is_empty())
        {
            "请先选择 JumpServer、资产和账号"
        } else {
            ""
        }
    } else if !valid_target(s(c, "target")) {
        "请先编辑并填写用户名和主机"
    } else if !(1..=65535).contains(&c["port"].as_u64().unwrap_or(22)) {
        "请先编辑并填写有效端口"
    } else if c["auth"] == "password" && s(c, "password").is_empty() {
        "请先编辑并保存密码"
    } else if c["auth"] == "key" && s(c, "identity").trim().is_empty() {
        "请先编辑并选择私钥或填写私钥路径"
    } else if c["auth"] != "password" && c["auth"] != "key" {
        "请先编辑并设置认证方式"
    } else {
        ""
    };
    json!({"canConnect":reason.is_empty(),"connectDisabledReason":reason,"hasPassword":c["auth"]=="password"&&!s(c,"password").is_empty()})
}
fn valid_target(value: &str) -> bool {
    let parts: Vec<_> = value.split('@').collect();
    parts.len() == 2
        && parts
            .iter()
            .all(|s| !s.is_empty() && !s.chars().any(char::is_whitespace))
        && !value.starts_with('-')
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
impl App {
    pub async fn run_cli(&self, args: &[&str]) -> Result<Output> {
        execute(
            "ssh-hold",
            &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            "",
            &self.hold,
            30,
        )
        .await
    }
    pub fn channels(&self) -> Result<Value> {
        let servers = self.store.servers()?;
        let mut out = vec![];
        for (name, c) in self.store.configs()? {
            let mut value = self.store.status(&name)?;
            value["name"] = json!(name);
            for key in [
                "started",
                "identity",
                "jump",
                "operatingSystem",
                "architecture",
            ] {
                if key != "started" || value[key].is_null() {
                    value[key] = json!(s(&c, key));
                }
            }
            value["started"] = json!(c["createdAt"]
                .as_str()
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| s(&c, "started")));
            for key in [
                "source",
                "serverId",
                "assetId",
                "assetName",
                "assetAddress",
                "account",
                "accountUsername",
                "auth",
                "insecure",
            ] {
                value[key] = c[key].clone();
            }
            if value["source"].is_null() {
                value["source"] = json!("manual");
            }
            value["target"] = json!(format!(
                "{}:{}",
                s(&c, "target"),
                c["port"].as_u64().unwrap_or(22)
            ));
            value["serverName"] = json!(servers
                .iter()
                .find(|server| server["id"] == c["serverId"])
                .map(|server| s(server, "name"))
                .unwrap_or("配置已移除"));
            value
                .as_object_mut()
                .unwrap()
                .extend(availability(&c).as_object().unwrap().clone());
            out.push(value);
        }
        Ok(json!(out))
    }
    pub fn import_channels(&self) -> Result<(u64, Vec<String>)> {
        let _gate = self
            .data_gate
            .try_read()
            .map_err(|_| Error::status(409, "备份正在恢复"))?;
        let mut count = 0;
        let mut skipped = vec![];
        let Ok(entries) = std::fs::read_dir(&self.hold) else {
            return Ok((0, skipped));
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_name(&name)
                || !entry.file_type()?.is_dir()
                || self.operations.lock().unwrap().contains(&name)
            {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(entry.path().join("meta")) else {
                continue;
            };
            let parsed = (|| -> Result<Value> {
                let mut meta = HashMap::new();
                for line in raw.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        if !k.bytes().all(|b| b.is_ascii_uppercase()) {
                            continue;
                        }
                        let v = if v.len() >= 2
                            && v.starts_with('\'')
                            && v.ends_with('\'')
                            && !v[1..v.len() - 1].contains('\'')
                        {
                            v[1..v.len() - 1].to_string()
                        } else {
                            if v.starts_with('$') || v.starts_with('"') {
                                return Err(Error::bad("元数据格式无效"));
                            }
                            let mut chars = v.chars();
                            let mut out = String::new();
                            while let Some(c) = chars.next() {
                                if c == '\\' {
                                    if let Some(c) = chars.next() {
                                        out.push(c);
                                    }
                                } else {
                                    out.push(c);
                                }
                            }
                            out
                        };
                        meta.insert(k.to_owned(), v);
                    }
                }
                let target = meta.get("TARGET").map(String::as_str).unwrap_or("");
                let port = meta
                    .get("PORT")
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0);
                if !valid_target(target) || !(1..=65535).contains(&port) {
                    return Err(Error::bad("无效连接信息"));
                }
                let mut config = self.store.config(&name)?.unwrap_or(json!({}));
                if config["source"] != "jumpserver" {
                    config["target"] = json!(target);
                    config["port"] = json!(port);
                    config["auth"] =
                        json!(if meta.get("AUTH").map(String::as_str) == Some("key") {
                            "key"
                        } else {
                            "password"
                        });
                    config["insecure"] =
                        json!(meta.get("INSECURE").map(String::as_str) == Some("1"));
                }
                config["started"] = json!(meta.get("STARTED").cloned().unwrap_or_default());
                Ok(config)
            })();
            match parsed {
                Ok(c) => {
                    self.store.save(&name, &c)?;
                    count += 1;
                }
                Err(_) => skipped.push(name),
            }
        }
        Ok((count, skipped))
    }
    pub async fn refresh_statuses(self: &Arc<Self>) -> Result<()> {
        let _gate = self
            .data_gate
            .try_read()
            .map_err(|_| Error::status(409, "备份正在恢复"))?;
        let revision = self.status_revision.load(Ordering::SeqCst);
        let output = self.run_cli(&["list"]).await?;
        if !output.ok {
            return Err(Error::bad("读取通道状态失败"));
        }
        let live = parse_list(&output.stdout);
        // A CLI list may have captured the temporary stop during an edit.
        // Serialize commits with operation boundaries and discard stale results.
        let operations = self.operations.lock().unwrap();
        if self.status_revision.load(Ordering::SeqCst) != revision {
            return Ok(());
        }
        for (name, _) in self.store.configs()? {
            if operations.contains(&name) {
                continue;
            }
            let mut snapshot = live
                .iter()
                .find(|c| c["name"] == name)
                .cloned()
                .unwrap_or(json!({"status":"已断开","keepalive":"停了"}));
            snapshot["checkedAt"] = json!(now());
            self.store.snapshot(&name, &snapshot)?;
            if snapshot["status"] == "畅通" {
                self.probe_platform(name);
            }
        }
        self.publish();
        Ok(())
    }
    pub fn probe_platform(self: &Arc<Self>, name: String) {
        let app = self.clone();
        tokio::spawn(async move {
            let _ = app.collect_platform(&name).await;
        });
    }
    async fn collect_platform(&self, name: &str) -> Result<()> {
        let _gate = self.data_gate.read().await;
        let Some(config) = self.store.config(name)? else {
            return Ok(());
        };
        if !s(&config, "operatingSystem").is_empty() && !s(&config, "architecture").is_empty() {
            return Ok(());
        }
        {
            let mut probes = self.probes.lock().unwrap();
            if probes.get(name).is_some_and(|last| now() - last < 60000) {
                return Ok(());
            }
            probes.insert(name.into(), now());
        }
        let command="printf '\\nSSH_HOLD_OS='; uname -s; printf 'SSH_HOLD_ARCH='; uname -m; if [ -r /etc/os-release ]; then sed -n 's/^PRETTY_NAME=/SSH_HOLD_DISTRO=/p' /etc/os-release; fi";
        let output = self.run_cli(&["run", name, "--", command]).await?;
        if !output.ok {
            return Ok(());
        }
        let mut values = HashMap::new();
        for line in output.stdout.lines() {
            if let Some((key, value)) = line.split_once('=') {
                if ["SSH_HOLD_OS", "SSH_HOLD_DISTRO", "SSH_HOLD_ARCH"].contains(&key)
                    && value.len() <= 200
                    && !value.chars().any(char::is_control)
                {
                    values.insert(key, value.trim_matches(['\'', '"']));
                }
            }
        }
        if self.store.config(name)? != Some(config.clone()) {
            return Ok(());
        }
        let mut updated = config.clone();
        let os = values.get("SSH_HOLD_DISTRO").or(values.get("SSH_HOLD_OS"));
        if let Some(os) = os {
            updated["operatingSystem"] = json!(os);
        }
        if let Some(arch) = values.get("SSH_HOLD_ARCH") {
            updated["architecture"] = json!(arch);
        }
        self.store.compare_save(name, &config, &updated)?;
        self.publish();
        Ok(())
    }
    pub async fn proxy(&self, name: &str, config: &Value) -> Result<Vec<String>> {
        let first = s(config, "jump");
        if first.is_empty() {
            return Ok(vec![]);
        }
        let configs = self.store.configs()?;
        let mut visited = HashSet::from([name.to_string()]);
        let mut jump = first.to_string();
        while !jump.is_empty() {
            if !valid_name(&jump) || !visited.insert(jump.clone()) {
                return Err(Error::bad("跳板通道不能指向自身或形成循环"));
            }
            let c = configs
                .iter()
                .find(|(n, _)| n == &jump)
                .ok_or_else(|| Error::bad(format!("跳板通道 {jump} 不存在，请先 Reload 导入")))?;
            jump = s(&c.1, "jump").into();
        }
        let socket = self.hold.join(first).join("sock");
        let control = format!("ControlPath={}", socket.display());
        let out = execute(
            "ssh",
            &[
                "-O".into(),
                "check".into(),
                "-o".into(),
                control.clone(),
                "dummy".into(),
            ],
            "",
            &self.hold,
            5,
        )
        .await?;
        if !out.ok {
            return Err(Error::bad(format!(
                "跳板通道 {first} 未连接，请先连接跳板通道"
            )));
        }
        Ok(vec![
            "-o".into(),
            format!(
                "ProxyCommand=ssh -o {} -o ControlMaster=no -o BatchMode=yes -W %h:%p dummy",
                quote(&control)
            ),
        ])
    }
    async fn resolve(&self, c: &Value) -> Result<Value> {
        if c["source"] == "jumpserver" {
            jumpserver::resolve(&self.store.server(s(c, "serverId"))?, c).await
        } else {
            Ok(c.clone())
        }
    }
    async fn start(&self, name: &str, config: &Value, resolved: Value, owner: &str) -> Result<()> {
        let proxy = self.proxy(name, &resolved).await?;
        let mut args = vec![
            "start".into(),
            "-n".into(),
            name.into(),
            "-p".into(),
            resolved["port"].as_u64().unwrap_or(22).to_string(),
            "-o".into(),
            "ConnectTimeout=15".into(),
            "-o".into(),
            "ConnectionAttempts=1".into(),
        ];
        if resolved["insecure"] == true {
            args.push("--insecure".into());
        }
        if resolved["auth"] == "key" {
            args.extend(["-i".into(), s(&resolved, "identity").into()]);
        } else {
            args.push("--password-stdin".into());
        }
        args.extend(proxy.clone());
        args.push(s(&resolved, "target").into());
        let result = execute("ssh-hold", &args, s(&resolved, "password"), &self.hold, 45).await?;
        if !result.ok {
            let text = if result.stderr.is_empty() {
                result.stdout
            } else {
                result.stderr
            };
            if let Some(challenge) =
                crate::host_keys::challenge(self, &text, &resolved, &proxy, owner).await?
            {
                return Err(Error {
                    status: 400,
                    message: "SSH 主机指纹已变化，请核实后确认信任".into(),
                    extra: json!({"hostKeyChallenge":challenge}),
                });
            }
            let text = if config["source"] == "jumpserver" && !s(&resolved, "password").is_empty() {
                text.replace(s(&resolved, "password"), "[redacted]")
            } else {
                text
            };
            return Err(Error::bad(text));
        }
        Ok(())
    }
    async fn stop_channel(&self, name: &str) -> Result<()> {
        if self.hold.join(name).join("meta").exists() {
            let result = self.run_cli(&["stop", name]).await?;
            if !result.ok {
                return Err(Error::bad(result.stderr));
            }
        }
        Ok(())
    }
    pub fn identity(&self, body: &mut Value) -> Result<()> {
        if body["auth"] != "key" || s(body, "identityContent").is_empty() {
            return Ok(());
        }
        let text = s(body, "identityContent");
        if text.len() > 65536
            || !regex::Regex::new(
                r"-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----",
            )
            .unwrap()
            .is_match(text)
        {
            return Err(Error::bad("请选择有效的 SSH 私钥文件（最大 64KB）"));
        }
        let dir = self.store.directory.join("keys");
        store::private_dir(&dir)?;
        let file = dir.join(format!("{}.key", uuid::Uuid::new_v4()));
        crate::system::private_write(&file, text.as_bytes())?;
        body["identity"] = json!(file);
        body.as_object_mut().unwrap().remove("identityContent");
        Ok(())
    }
    async fn config_input(&self, body: &Value, old: &Value) -> Result<Value> {
        if body["source"] == "jumpserver" {
            return jumpserver::channel(&self.store.server(s(body, "serverId"))?, body).await;
        }
        if body.get("source").is_some() && body["source"] != "manual" {
            return Err(Error::bad("连接来源无效"));
        }
        let port = match body.get("port") {
            None => 22,
            Some(value) => value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
                .filter(|port| (1..=65535).contains(port))
                .ok_or_else(|| Error::bad("请先编辑并填写有效端口"))?,
        };
        let c = json!({"source":"manual","target":body["target"],"port":port,"auth":body["auth"].as_str().unwrap_or("password"),"identity":body.get("identity").unwrap_or(&old["identity"]),"password":if s(body,"password").is_empty(){s(old,"password")}else{s(body,"password")},"jump":s(body,"jump"),"insecure":body["insecure"]==true});
        let available = availability(&c);
        if available["canConnect"] != true {
            return Err(Error::bad(s(&available, "connectDisabledReason")));
        }
        Ok(c)
    }
    async fn result(self: &Arc<Self>, name: &str) -> Result<Value> {
        let output = self.run_cli(&["status", name]).await?;
        let mut status = parse_list(&output.stdout)
            .into_iter()
            .next()
            .unwrap_or(json!({"name":name,"status":"畅通"}));
        status["checkedAt"] = json!(now());
        self.store.snapshot(name, &status)?;
        self.probe_platform(name.into());
        self.publish();
        Ok(self
            .channels()?
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .cloned()
            .unwrap_or(status))
    }
}
struct Operation<'a> {
    app: &'a App,
    name: String,
}
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        {
            let mut operations = self.app.operations.lock().unwrap();
            operations.remove(&self.name);
            self.app.status_revision.fetch_add(1, Ordering::SeqCst);
        }
        self.app.publish();
    }
}
pub async fn api(
    app: &Arc<App>,
    headers: &HeaderMap,
    ip: &str,
    method: &Method,
    path: &str,
    query: &HashMap<String, String>,
    mut body: Value,
) -> Result<Response> {
    let _gate = app
        .data_gate
        .try_read()
        .map_err(|_| Error::status(409, "备份正在恢复"))?;
    let owner = app
        .session(headers)
        .ok_or_else(|| Error::status(401, "登录状态已失效"))?;
    let pieces: Vec<_> = path.trim_matches('/').split('/').collect();
    let name = if pieces.len() == 2 {
        s(&body, "name")
    } else {
        pieces[2]
    }
    .to_string();
    if !valid_name(&name) {
        return Err(Error::bad("通道名称无效"));
    }
    if pieces.get(3) == Some(&"password") && *method == Method::POST {
        app.confirm(headers, s(&body, "password"), ip).await?;
        let c = app
            .store
            .config(&name)?
            .ok_or_else(|| Error::status(404, "通道不存在"))?;
        if c["auth"] != "password" || c["source"] == "jumpserver" || s(&c, "password").is_empty() {
            return Err(Error::status(404, "未保存通道密码"));
        }
        return Ok(ok(json!({"password":c["password"]})));
    }
    if ![Method::POST, Method::PUT, Method::DELETE].contains(method) {
        return Err(Error::status(405, "Method not allowed"));
    }
    {
        let mut operations = app.operations.lock().unwrap();
        if !operations.insert(name.clone()) {
            return Err(Error::status(409, "该通道正在连接或更新，请稍后重试"));
        }
        app.status_revision.fetch_add(1, Ordering::SeqCst);
    }
    let _guard = Operation {
        app,
        name: name.clone(),
    };
    let old = app.store.config(&name)?;
    if pieces.len() > 2 && old.is_none() {
        return Err(Error::status(404, "通道不存在"));
    }
    if *method == Method::DELETE {
        app.stop_channel(&name).await?;
        let mut db = app.store.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute("DELETE FROM channels WHERE name=?", [&name])?;
        tx.execute("DELETE FROM channel_status WHERE name=?", [&name])?;
        tx.commit()?;
        return Ok(ok(json!({"ok":true})));
    }
    if query.get("action").map(String::as_str) == Some("disconnect") {
        app.stop_channel(&name).await?;
        app.store.snapshot(
            &name,
            &json!({"status":"已断开","keepalive":"停了","remote":"","checkedAt":now()}),
        )?;
        return Ok(ok(
            json!({"ok":true,"channel":app.channels()?.as_array().unwrap().iter().find(|c|c["name"]==name)}),
        ));
    }
    let create = pieces.len() == 2;
    if create && (old.is_some() || app.hold.join(&name).join("meta").exists()) {
        return Err(Error::status(409, "通道名称已存在，请使用其他名称"));
    }
    let config = if create || *method == Method::PUT {
        app.identity(&mut body)?;
        app.config_input(&body, &old.unwrap_or(json!({}))).await?
    } else {
        old.unwrap()
    };
    let a = availability(&config);
    if a["canConnect"] != true {
        return Err(Error::bad(s(&a, "connectDisabledReason")));
    }
    app.proxy(&name, &config).await?;
    let resolved = app.resolve(&config).await?;
    if !app.store.valid_session(&owner) {
        return Err(Error::status(401, "登录状态已失效"));
    }
    if !create {
        if *method == Method::PUT {
            app.store.save(&name, &config)?;
        }
        app.stop_channel(&name).await?;
    }
    app.start(&name, &config, resolved, &owner).await?;
    app.store.save(&name, &config)?;
    let channel = app.result(&name).await?;
    Ok((
        if create {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(json!({"ok":true,"channel":channel})),
    )
        .into_response())
}
