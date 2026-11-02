use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str = "https://github.com/jacobs-256/ssh-hold-deck/releases/latest/download/latest.json";
const PUBLIC_KEY: &str = match option_env!("TAURI_UPDATER_PUBLIC_KEY") { Some(key) => key, None => "" };

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    current_version: String,
    configured: bool,
}

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    status: Mutex<Status>,
    pending: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }

#[tauri::command]
pub async fn desktop_update(app: tauri::AppHandle, window: tauri::WebviewWindow, action: String) -> Result<Status, String> {
    super::verify_desktop_origin(&app, &window)?;
    let state = app.state::<UpdateState>();
    {
        let mut status = state.status.lock().unwrap();
        status.current_version = app.package_info().version.to_string();
        status.configured = !PUBLIC_KEY.trim().is_empty();
    }
    if action == "status" { return Ok(state.status.lock().unwrap().clone()); }
    if !["check", "download", "install"].contains(&action.as_str()) { return Err("Invalid update action".into()); }
    if PUBLIC_KEY.trim().is_empty() { return Err("Updater signing public key is not configured in this build".into()); }
    if state.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("An update operation is already in progress".into());
    }
    let _busy = Busy(&state.busy);
    match action.as_str() {
        "check" => {
            // Keep a verified download until the user installs it or quits.
            if state.bytes.lock().unwrap().is_some() { return Ok(state.status.lock().unwrap().clone()); }
            let backend = app.state::<std::sync::Arc<super::Backend>>().inner().clone();
            let updater = app.updater_builder().pubkey(PUBLIC_KEY.trim())
                .endpoints(vec![ENDPOINT.parse().expect("Valid update endpoint")])
                .map_err(|e| e.to_string())?
                .timeout(Duration::from_secs(30))
                .on_before_exit(move || backend.stop())
                .build().map_err(|e| e.to_string())?;
            let update = updater.check().await.map_err(|e| e.to_string())?;
            let mut status = state.status.lock().unwrap();
            status.phase = if update.is_some() { "available" } else { "current" }.into();
            status.version = update.as_ref().map(|u| u.version.clone());
            status.notes = update.as_ref().and_then(|u| u.body.clone());
            status.downloaded = 0;
            status.total = None;
            *state.pending.lock().unwrap() = update;
        }
        "download" => {
            let update = state.pending.lock().unwrap().take().ok_or("Check for an update first")?;
            if state.bytes.lock().unwrap().is_some() {
                *state.pending.lock().unwrap() = Some(update);
                return Ok(state.status.lock().unwrap().clone());
            }
            state.status.lock().unwrap().phase = "downloading".into();
            let result = update.download(|chunk, total| {
                let mut status = state.status.lock().unwrap();
                status.downloaded += chunk as u64;
                status.total = total;
            }, || {}).await;
            *state.pending.lock().unwrap() = Some(update);
            match result {
                Ok(bytes) => {
                    *state.bytes.lock().unwrap() = Some(bytes);
                    state.status.lock().unwrap().phase = "ready".into();
                }
                Err(error) => {
                    let mut status = state.status.lock().unwrap();
                    status.phase = "available".into(); status.downloaded = 0; status.total = None;
                    return Err(error.to_string());
                }
            }
        }
        "install" => {
            if state.bytes.lock().unwrap().is_none() { return Err("Download and verify the update first".into()); }
            let update = state.pending.lock().unwrap().take().ok_or("No pending update")?;
            let bytes = state.bytes.lock().unwrap().take().ok_or("Download and verify the update first")?;
            let result = tauri::async_runtime::spawn_blocking(move || {
                let result = update.install(&bytes);
                (update, bytes, result)
            }).await.map_err(|e| e.to_string())?;
            *state.pending.lock().unwrap() = Some(result.0);
            *state.bytes.lock().unwrap() = Some(result.1);
            result.2.map_err(|e| e.to_string())?;
            app.state::<std::sync::Arc<super::Backend>>().stop();
            app.restart();
        }
        _ => unreachable!(),
    }
    let status = state.status.lock().unwrap().clone();
    Ok(status)
}
