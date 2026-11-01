#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewUrl};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    close_behavior: String,
    tray_enabled: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self { Self { close_behavior: "ask".into(), tray_enabled: true } }
}

struct DesktopState(Mutex<DesktopSettings>);

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
    }
}

fn verify_desktop_origin(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let port = *app.state::<Arc<Backend>>().port.lock().unwrap();
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || port.is_none() || url.port() != port {
        return Err("Untrusted settings origin".into());
    }
    Ok(())
}

#[tauri::command]
async fn desktop_save_backup(app: tauri::AppHandle, window: tauri::WebviewWindow, contents: String) -> Result<bool, String> {
    verify_desktop_origin(&app, &window)?;
    if contents.len() > 20 * 1024 * 1024 { return Err("Backup exceeds 20MB".into()); }
    let envelope: serde_json::Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    if envelope["format"].as_str() != Some("ssh-hold-deck-backup") || envelope["version"].as_u64() != Some(1) {
        return Err("Invalid backup format".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let file = app.dialog().file().add_filter("SSH Hold Deck backup", &["json"])
            .set_file_name("ssh-hold-deck-backup.json").blocking_save_file();
        let Some(file) = file else { return Ok(false); };
        let path = file.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path, contents).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn desktop_settings(app: tauri::AppHandle, window: tauri::WebviewWindow, settings: Option<DesktopSettings>) -> Result<DesktopSettings, String> {
    verify_desktop_origin(&app, &window)?;
    let state = app.state::<DesktopState>();
    let mut current = state.0.lock().unwrap();
    if let Some(settings) = settings {
        if !["ask", "tray", "quit"].contains(&settings.close_behavior.as_str()) || (!settings.tray_enabled && settings.close_behavior == "tray") {
            return Err("Minimizing to tray requires a tray icon".into());
        }
        let path = app.path().app_config_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        std::fs::write(path.join("desktop-settings.json"), serde_json::to_vec(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if let Some(tray) = app.tray_by_id("main") { tray.set_visible(settings.tray_enabled).map_err(|e| e.to_string())?; }
        *current = settings;
    }
    Ok(current.clone())
}

#[derive(Default)]
struct Backend {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    error: Mutex<Option<String>>,
}

impl Backend {
    fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // EOF is observed inside Node, including across the WSL launcher.
            drop(child.stdin.take());
            for _ in 0..50 {
                if child.try_wait().ok().flatten().is_some() { return; }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(windows)]
fn wsl_command() -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("wsl.exe");
    cmd.creation_flags(0x08000000);
    if let Ok(distro) = std::env::var("SSH_HOLD_WSL_DISTRO") { cmd.args(["--distribution", &distro]); }
    cmd
}

#[cfg(windows)]
fn wsl_path(path: &std::path::Path) -> Result<String, String> {
    let output = wsl_command().args(["--exec", "wslpath", "-u"]).arg(path).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("Cannot map application paths into WSL.".into()); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn backend_command(app: &tauri::AppHandle, token: &str) -> Result<Command, String> {
    let resources = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop")
    } else { app.path().resource_dir().map_err(|e| e.to_string())? };
    let backend = resources.join("backend");
    #[cfg(not(windows))]
    {
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data");
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let mut command = Command::new(backend.join("runtime/node"));
        command.arg(backend.join("backend-entry.mjs")).current_dir(&backend)
            .env("HOST", "127.0.0.1").env("SSH_HOLD_DESKTOP_TOKEN", token)
            .env("SSH_HOLD_WEB_DATA_DIR", data);
        Ok(command)
    }
    #[cfg(windows)]
    {
        let kernel = wsl_command().args(["--exec", "uname", "-r"]).output()
            .map_err(|_| "WSL2 is required. Install WSL2 and initialize a Linux distribution, then reopen SSH Hold Deck.".to_string())?;
        if !kernel.status.success() || !String::from_utf8_lossy(&kernel.stdout).to_lowercase().contains("wsl2") {
            return Err("An initialized WSL2 distribution is required. Run wsl --install and finish Linux user setup. SSH_HOLD_WSL_DISTRO can select a distribution.".into());
        }
        let home = std::env::var_os("USERPROFILE").ok_or("USERPROFILE is unavailable")?;
        let mut command = wsl_command();
        command.args(["--exec", "bash", &wsl_path(&resources.join("start-wsl.sh"))?,
            &wsl_path(&backend)?, &wsl_path(std::path::Path::new(&home))?,
            app.package_info().version.to_string().as_str(), token]);
        Ok(command)
    }
}

fn show_error(app: &tauri::AppHandle, error: &str) {
    *app.state::<Arc<Backend>>().error.lock().unwrap() = Some(error.to_string());
    if let Some(window) = app.get_webview_window("main") {
        let message = serde_json::to_string(&format!("Cannot start local service. / 无法启动本地服务。\n\n{error}\n\nClose and reopen the application to retry. / 请关闭并重新打开应用重试。")).unwrap();
        let _ = window.eval(&format!("document.body.textContent={message};document.body.style.cssText='padding:32px;white-space:pre-wrap;font:14px system-ui;line-height:1.8'"));
        let _ = window.show();
    }
}

fn start_backend(app: tauri::AppHandle, state: Arc<Backend>) -> Result<(), String> {
    let token = uuid::Uuid::new_v4().to_string();
    let mut command = backend_command(&app, &token)?;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(logs.join("backend.log")).map_err(|e| e.to_string())?;
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log)).spawn()
        .map_err(|e| format!("{e}\nBackend resources: {}", command.get_program().to_string_lossy()))?;
    let stdout = child.stdout.take().ok_or("Missing backend stdout")?;
    *state.child.lock().unwrap() = Some(child);
    let (sender, receiver) = std::sync::mpsc::channel();
    let reader_state = state.clone();
    let reader_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(event) = line.strip_prefix("SSH_HOLD_DESKTOP_READY ") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(event) {
                    if value["token"].as_str() != Some(&token) { continue; }
                    if let Some(port) = value["port"].as_u64().filter(|p| *p > 0 && *p <= 65535) {
                        *reader_state.port.lock().unwrap() = Some(port as u16);
                        let _ = sender.send(port);
                    }
                }
            }
        }
        *reader_state.port.lock().unwrap() = None;
        show_error(&reader_app, "The backend exited. Check backend.log in the application log directory.");
    });
    let port = receiver.recv_timeout(Duration::from_secs(90)).map_err(|_| "Backend startup timed out. Check backend.log; on Windows verify WSL2 is initialized.".to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(format!("http://127.0.0.1:{port}/").parse().unwrap()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    let backend = Arc::new(Backend::default());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_settings, desktop_save_backup])
        .setup({ let backend = backend.clone(); move |app| {
            let state = backend.clone();
            let navigation_app = app.handle().clone();
            let external_app = app.handle().clone();
            app.manage(backend.clone());
            let config = app.path().app_config_dir()?.join("desktop-settings.json");
            let mut settings: DesktopSettings = std::fs::read(config).ok().and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default();
            if !["ask", "tray", "quit"].contains(&settings.close_behavior.as_str()) { settings.close_behavior = "ask".into(); }
            if !settings.tray_enabled && settings.close_behavior == "tray" { settings.close_behavior = "ask".into(); }
            let show = tauri::menu::MenuItem::with_id(app, "show", "显示 / Show", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出应用 / Quit", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
            let tray = tauri::tray::TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("Application icon").clone())
                .tooltip("SSH Hold Deck").menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() { "show" => show_main(app), "quit" => app.exit(0), _ => {} })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) { show_main(tray.app_handle()); }
                }).build(app)?;
            tray.set_visible(settings.tray_enabled)?;
            app.manage(DesktopState(Mutex::new(settings)));
            let close_app = app.handle().clone();
            let close_handler = move |event: &tauri::WindowEvent| {
                    let window = match close_app.get_webview_window("main") { Some(window) => window, None => return };
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let app = window.app_handle();
                        let settings = app.state::<DesktopState>().0.lock().unwrap().clone();
                        if settings.close_behavior == "quit" { app.exit(0); return; }
                        api.prevent_close();
                        if settings.close_behavior == "tray" && settings.tray_enabled { let _ = window.hide(); return; }
                        let handle = app.clone();
                        let buttons = if settings.tray_enabled {
                            MessageDialogButtons::YesNoCancelCustom("最小化到托盘 / Hide to tray".into(), "退出应用 / Quit".into(), "取消 / Cancel".into())
                        } else { MessageDialogButtons::OkCancelCustom("退出应用 / Quit".into(), "取消 / Cancel".into()) };
                        app.dialog().message("请选择关闭窗口后的操作。 / Choose what happens when closing the window.")
                            .title("SSH Hold Deck").buttons(buttons).show_with_result(move |result| {
                                if let MessageDialogResult::Custom(label) = result {
                                    if label == "退出应用 / Quit" { handle.exit(0); }
                                    else if label == "最小化到托盘 / Hide to tray" {
                                        if let Some(window) = handle.get_webview_window("main") { let _ = window.hide(); }
                                    }
                                }
                            });
                    }
                };
            let window = tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("SSH Hold Deck").inner_size(1280.0, 860.0).min_inner_size(800.0, 600.0)
                .on_new_window(move |url, _| {
                    if matches!(url.scheme(), "https" | "http") {
                        let _ = external_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_page_load(|window, _| {
                    let error = window.app_handle().state::<Arc<Backend>>().error.lock().unwrap().clone();
                    if let Some(error) = error { show_error(window.app_handle(), &error); }
                })
                .on_navigation(move |url| {
                    if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") { return true; }
                    let expected = *state.port.lock().unwrap();
                    let allowed = url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
                        && expected.is_some() && url.port() == expected;
                    if !allowed && matches!(url.scheme(), "https" | "http") {
                        let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    allowed
                }).build()?;
            window.on_window_event(close_handler);
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = start_backend(handle.clone(), backend.clone()) { backend.stop(); show_error(&handle, &error); }
            });
            Ok(())
        }})
        .build(tauri::generate_context!())
        .expect("Unable to initialize SSH Hold Deck desktop");
    app.run(move |_, event| {
        if matches!(event, tauri::RunEvent::Exit) { backend.stop(); }
    });
}
