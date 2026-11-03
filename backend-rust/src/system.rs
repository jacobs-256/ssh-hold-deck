use crate::{channels::execute, ok, s, store, App, Error, Result};
use axum::{
    http::{HeaderMap, Method},
    response::Response,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};
pub fn private_write(path: &Path, data: &[u8]) -> Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(data)?;
    Ok(())
}
pub async fn response_bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().unwrap_or(0) > limit as u64 {
        return Err(Error::bad("响应文件过大"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            return Err(Error::bad("响应文件过大"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn port_owners(app: &App, port: u16) -> (Vec<Value>, bool) {
    let output = execute(
        "lsof",
        &[
            "-nP".into(),
            format!("-iTCP:{port}"),
            "-sTCP:LISTEN".into(),
            "-Fpc".into(),
        ],
        "",
        &app.hold,
        3,
    )
    .await;
    let Ok(output) = output else {
        return (vec![], false);
    };
    let mut owners = Vec::new();
    let mut current = None;
    for line in output.stdout.lines() {
        if let Some(pid) = line.strip_prefix('p').and_then(|s| s.parse::<u32>().ok()) {
            current = if pid != std::process::id() {
                owners.push(json!({"pid":pid,"command":""}));
                Some(owners.len() - 1)
            } else {
                None
            };
        } else if let (Some(index), Some(command)) = (current, line.strip_prefix('c')) {
            owners[index]["command"] = json!(command);
        }
    }
    (owners, true)
}
fn find_cli(command: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .chain([
            crate::home().join(".local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .map(|p| p.join(command))
        .find(|p| {
            p.is_file() && {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    p.metadata()
                        .map(|m| m.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false)
                }
                #[cfg(not(unix))]
                {
                    true
                }
            }
        })
}
async fn cli(app: &App) -> Result<Value> {
    if let Some(path) = find_cli("ssh-hold") {
        let output = execute(
            &path.to_string_lossy(),
            &["version".into()],
            "",
            &app.hold,
            5,
        )
        .await
        .ok();
        Ok(
            json!({"installed":true,"path":path,"version":output.map(|o|o.stdout.trim().to_owned()),"installing":false}),
        )
    } else {
        Ok(json!({"installed":false,"supported":!cfg!(windows),"installing":false}))
    }
}
pub async fn api(
    app: &Arc<App>,
    _headers: &HeaderMap,
    method: &Method,
    path: &str,
    _query: &HashMap<String, String>,
    body: Value,
) -> Result<Response> {
    let _gate = app
        .data_gate
        .try_read()
        .map_err(|_| Error::status(409, "备份正在恢复"))?;
    if path == "/api/system/ssh-hold" && *method == Method::GET {
        return Ok(ok(cli(app).await?));
    }
    if path == "/api/system/ssh-hold/install" && *method == Method::POST {
        let _lock = app.system_lock.lock().await;
        let current = cli(app).await?;
        if current["installed"] == true {
            return Ok(ok(current));
        }
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()?
            .get("https://github.com/CherryLover/ssh-hold/releases/latest/download/ssh-hold")
            .send()
            .await?
            .error_for_status()?;
        let bytes = response_bytes(response, 4 * 1024 * 1024).await?;
        if bytes.len() > 4 * 1024 * 1024 || !bytes.starts_with(b"#!") {
            return Err(Error::bad("下载的安装文件格式无效"));
        }
        let directory = crate::home().join(".local/bin");
        store::private_dir(&directory)?;
        let temporary = directory.join(format!(".ssh-hold-{}", uuid::Uuid::new_v4()));
        private_write(&temporary, &bytes)?;
        let result = execute(
            "/bin/bash",
            &["-n".into(), temporary.to_string_lossy().into()],
            "",
            &app.hold,
            5,
        )
        .await;
        match result {
            Ok(out) if out.ok => {
                store::private_mode(&temporary, 0o755)?;
                std::fs::rename(&temporary, directory.join("ssh-hold"))?;
            }
            _ => {
                let _ = std::fs::remove_file(temporary);
                return Err(Error::bad("下载的安装文件语法无效"));
            }
        }
        return Ok(ok(cli(app).await?));
    }
    if path == "/api/system/agent-skills" && *method == Method::GET {
        return Ok(ok(agent_list()));
    }
    if let Some(id) = path.strip_prefix("/api/system/agent-skills/") {
        if *method == Method::POST || *method == Method::DELETE {
            let _lock = app.system_lock.lock().await;
            let catalog = agents();
            let agent = catalog
                .iter()
                .find(|a| a.id == id)
                .ok_or_else(|| Error::bad("未知的 AI Agent"))?;
            if !agent.detected() {
                return Err(Error::status(404, "未检测到该 AI Agent"));
            }
            if *method == Method::DELETE && body["confirmed"] != true {
                return Err(Error::bad("请先确认卸载 ssh-hold skill"));
            }
            let entries = agent.entries();
            if *method == Method::POST && entries.is_empty() {
                let directory = agent.roots[0].join("ssh-hold");
                std::fs::create_dir_all(&agent.roots[0])?;
                std::fs::create_dir(&directory)
                    .map_err(|_| Error::status(409, "目标目录已存在，请先检查目录内容"))?;
                let markdown = std::fs::read_to_string(app.root.join("assets/ssh-hold-skill.md"))?;
                let contents=format!("---\nname: ssh-hold\ndescription: Keep and reuse SSH connections with ssh-hold, including jump hosts, one-time passwords, remote commands and file transfers.\n---\n\n{markdown}");
                private_write(&directory.join("SKILL.md"), contents.as_bytes())?;
            } else if *method == Method::DELETE {
                let backup = agent_home()
                    .join(".local/share/ssh-hold-deck/skill-backups")
                    .join(format!("{id}-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir_all(&backup)?;
                let mut moved: Vec<(PathBuf, PathBuf)> = vec![];
                for (index, path) in entries.iter().enumerate() {
                    let target = backup.join(format!(
                        "{index}-{}",
                        path.file_name().unwrap().to_string_lossy()
                    ));
                    if let Err(error) = std::fs::rename(path, &target) {
                        for (from, to) in moved.iter().rev() {
                            let _ = std::fs::rename(to, from);
                        }
                        return Err(error.into());
                    }
                    moved.push((path.clone(), target));
                }
                std::fs::write(
                    backup.join("manifest.json"),
                    serde_json::to_vec(
                        &moved
                            .iter()
                            .map(|(from, to)| json!({"from":from,"to":to}))
                            .collect::<Vec<_>>(),
                    )?,
                )?;
            }
            return Ok(ok(agent_list()));
        }
    }
    if path == "/api/settings/refresh" {
        if *method == Method::POST {
            let n = body["seconds"]
                .as_u64()
                .ok_or_else(|| Error::bad("请选择有效的刷新间隔"))?;
            if ![0, 5, 10, 30, 60].contains(&n) {
                return Err(Error::bad("请选择有效的刷新间隔"));
            }
            app.store.set("refreshSeconds", &n.to_string())?;
            app.refresh.store(n, Ordering::Relaxed);
        }
        return Ok(ok(json!({"seconds":app.refresh.load(Ordering::Relaxed)})));
    }
    if path == "/api/settings/service" && *method == Method::GET {
        let saved: Value =
            serde_json::from_str(&app.store.setting("service")?.unwrap_or("{}".into()))?;
        return Ok(ok(
            json!({"port":saved["port"].as_u64().unwrap_or(app.port.load(Ordering::Relaxed) as u64),"activePort":app.port.load(Ordering::Relaxed),"autoSelect":app.desktop||saved["autoSelect"]==true}),
        ));
    }
    if ["/api/settings/service/check", "/api/settings/service"].contains(&path)
        && *method == Method::POST
    {
        let port = body["port"]
            .as_u64()
            .filter(|p| (1024..=65535).contains(p))
            .ok_or_else(|| Error::bad("服务端口必须为 1024–65535 的整数"))?
            as u16;
        let current = app.port.load(Ordering::Relaxed);
        let available = port == current
            || tokio::net::TcpListener::bind((app.host.as_str(), port))
                .await
                .is_ok();
        if path.ends_with("/check") {
            let (owners, details) = port_owners(app, port).await;
            return Ok(ok(
                json!({"port":port,"available":available,"current":port==current,"owners":owners,"detailsAvailable":details}),
            ));
        }
        if !body["autoSelect"].is_boolean() {
            return Err(Error::bad("服务端口配置无效"));
        }
        let auto = body["autoSelect"] == true;
        let listener = if port == current {
            None
        } else {
            Some(
                crate::bind(&app.host, port, auto)
                    .await
                    .map_err(|_| Error::status(409, "端口已被占用"))?,
            )
        };
        let active = listener
            .as_ref()
            .map(|l| l.local_addr().unwrap().port())
            .unwrap_or(current);
        app.store.set(
            "service",
            &json!({"port":port,"autoSelect":auto}).to_string(),
        )?;
        if let Some(listener) = listener {
            let rebind = app.rebind.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let _ = rebind.send(listener).await;
            });
        }
        return Ok(ok(
            json!({"port":port,"activePort":active,"autoSelect":auto,"restarting":true}),
        ));
    }
    Err(Error::status(404, "Not found"))
}
struct Agent {
    id: &'static str,
    name: &'static str,
    commands: Vec<&'static str>,
    apps: Vec<&'static str>,
    config: PathBuf,
    roots: Vec<PathBuf>,
}
fn agent_home() -> PathBuf {
    std::env::var_os("SSH_HOLD_WINDOWS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(crate::home)
}
fn agents() -> Vec<Agent> {
    let home = agent_home();
    let windows = std::env::var_os("SSH_HOLD_WINDOWS_HOME").is_some();
    let agent_env = |name: &str| {
        if windows {
            None
        } else {
            std::env::var_os(name)
        }
    };
    let config = agent_env("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let codex = agent_env("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let claude = agent_env("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    let dsh = agent_env("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".dsh"));
    vec![
        (
            "codex",
            "Codex",
            vec!["codex"],
            vec!["Codex.app", "ChatGPT.app"],
            codex.clone(),
            vec![codex.join("skills"), home.join(".agents/skills")],
        ),
        (
            "claude",
            "Claude Code",
            vec!["claude"],
            vec!["Claude.app"],
            claude.clone(),
            vec![claude.join("skills")],
        ),
        (
            "copilot",
            "GitHub Copilot",
            vec!["copilot"],
            vec![],
            home.join(".copilot"),
            vec![home.join(".copilot/skills")],
        ),
        (
            "opencode",
            "OpenCode",
            vec!["opencode"],
            vec!["OpenCode.app", "OpenCode Desktop.app"],
            config.join("opencode"),
            vec![
                config.join("opencode/skills"),
                home.join(".agents/skills"),
                home.join(".claude/skills"),
            ],
        ),
        (
            "deepseek",
            "DeepSeek Harness",
            vec!["dsh", "deepseek"],
            vec!["DeepSeek Harness.app"],
            dsh.clone(),
            vec![dsh.join("skills")],
        ),
        (
            "trae",
            "TRAE",
            vec!["trae"],
            vec!["Trae.app", "TRAE.app"],
            home.join(".trae"),
            vec![home.join(".trae/skills")],
        ),
        (
            "gemini",
            "Gemini CLI",
            vec!["gemini"],
            vec![],
            home.join(".gemini"),
            vec![home.join(".gemini/skills")],
        ),
        (
            "cursor",
            "Cursor",
            vec!["cursor", "agent"],
            vec!["Cursor.app"],
            home.join(".cursor"),
            vec![home.join(".cursor/skills")],
        ),
        (
            "kiro",
            "Kiro",
            vec!["kiro", "kiro-cli"],
            vec!["Kiro.app"],
            home.join(".kiro"),
            vec![home.join(".kiro/skills")],
        ),
    ]
    .into_iter()
    .map(|(id, name, commands, apps, config, roots)| Agent {
        id,
        name,
        commands,
        apps,
        config,
        roots,
    })
    .collect()
}
impl Agent {
    fn detected(&self) -> bool {
        if std::env::var_os("SSH_HOLD_WINDOWS_HOME").is_some() {
            return self.config.exists();
        }
        self.config.exists()
            || self.commands.iter().any(|c| find_cli(c).is_some())
            || self.apps.iter().any(|a| {
                PathBuf::from("/Applications").join(a).exists()
                    || agent_home().join("Applications").join(a).exists()
            })
    }
    fn entries(&self) -> Vec<PathBuf> {
        let mut out = vec![];
        for root in &self.roots {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.') {
                        continue;
                    }
                    let path = entry.path();
                    if let Ok(text) = std::fs::read_to_string(path.join("SKILL.md")) {
                        let text = text.replace("\r\n", "\n");
                        let yaml = text
                            .strip_prefix("---\n")
                            .and_then(|s| s.split_once("\n---"))
                            .map(|v| v.0)
                            .unwrap_or("");
                        let meta: Value = serde_yaml::from_str(yaml).unwrap_or(Value::Null);
                        if ["ssh-hold", "ssh-hold-skill"].contains(&name.as_str())
                            || ["ssh-hold", "ssh-hold-skill"].contains(&s(&meta, "name"))
                        {
                            if !out.contains(&path) {
                                out.push(path);
                            }
                        }
                    }
                }
            }
        }
        out
    }
}
fn agent_list() -> Value {
    json!({"agents":agents().into_iter().filter(|a|a.detected()).map(|a|{let paths=a.entries();json!({"id":a.id,"name":a.name,"skillInstalled":!paths.is_empty(),"paths":paths,"installPath":a.roots[0].join("ssh-hold")})}).collect::<Vec<_>>()})
}
