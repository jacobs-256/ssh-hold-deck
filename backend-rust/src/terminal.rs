use crate::{crypto, now, s, valid_name, App, Error, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderMap, Uri},
    response::{IntoResponse, Response},
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
pub struct Grant {
    pub name: String,
    pub owner: String,
    pub expires: i64,
}
pub async fn issue(app: &Arc<App>, headers: &HeaderMap, name: &str) -> Result<String> {
    let owner = app
        .session(headers)
        .ok_or_else(|| Error::status(401, "请先登录"))?;
    if !valid_name(name) || app.store.config(name)?.is_none() {
        return Err(Error::bad("通道不存在"));
    }
    let status = app.run_cli(&["status", name]).await?;
    if !status.ok || !status.stdout.contains("通道: 畅通") {
        return Err(Error::bad("请先连接该通道"));
    }
    if !app.store.valid_session(&owner) {
        return Err(Error::status(401, "登录状态已失效"));
    }
    let token = hex::encode(crypto::random::<32>());
    let mut grants = app.grants.lock().unwrap();
    grants.retain(|_, v| v.expires > now());
    if grants.len() >= 1000 {
        return Err(Error::status(429, "终端请求过多"));
    }
    grants.insert(
        token.clone(),
        Grant {
            name: name.into(),
            owner,
            expires: now() + 30000,
        },
    );
    Ok(token)
}
pub async fn upgrade(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    uri: Uri,
    ws: WebSocketUpgrade,
) -> Response {
    let token = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    let grant = app.grants.lock().unwrap().remove(&token);
    let Some(grant) = grant else {
        return Error::status(403, "终端授权无效").into_response();
    };
    if !app.origin(&headers, true)
        || grant.expires < now()
        || app.session(&headers) != Some(grant.owner.clone())
    {
        return Error::status(403, "终端授权已失效").into_response();
    }
    if app
        .terminal_count
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
            if n < 24 {
                Some(n + 1)
            } else {
                None
            }
        })
        .is_err()
    {
        return Error::status(429, "终端数量达到上限").into_response();
    }
    let count = CountGuard(app.clone());
    ws.max_message_size(65536)
        .max_frame_size(65536)
        .on_upgrade(move |socket| serve(app, grant, socket, count))
        .into_response()
}
struct CountGuard(Arc<App>);
impl Drop for CountGuard {
    fn drop(&mut self) {
        self.0.terminal_count.fetch_sub(1, Ordering::SeqCst);
    }
}
async fn serve(app: Arc<App>, grant: Grant, mut socket: WebSocket, _count: CountGuard) {
    let opened = (|| -> std::result::Result<_, Box<dyn std::error::Error + Send + Sync>> {
        let pair = native_pty_system().openpty(PtySize {
            rows: 28,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut command = CommandBuilder::new("ssh-hold");
        command.args(["shell", &grant.name]);
        command.cwd(crate::home());
        command.env("SSH_HOLD_DIR", &app.hold);
        command.env("TERM", "xterm-256color");
        let child = pair.slave.spawn_command(command)?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        Ok((pair.master, child, reader, writer))
    })();
    let Ok((master, mut child, mut reader, mut writer)) = opened else {
        let _ = socket
            .send(Message::Text(
                json!({"type":"error","message":"终端启动失败"})
                    .to_string()
                    .into(),
            ))
            .await;
        return;
    };
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let writer_task = tokio::task::spawn_blocking(move || {
        while let Some(bytes) = write_rx.blocking_recv() {
            if writer.write_all(&bytes).is_err() {
                break;
            }
        }
    });
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut block = [0; 8192];
        while let Ok(size) = reader.read(&mut block) {
            if size == 0 || tx.blocking_send(block[..size].to_vec()).is_err() {
                break;
            }
        }
    });
    let _ = socket
        .send(Message::Text(json!({"type":"ready"}).to_string().into()))
        .await;
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    let mut shutdown = app.shutdown.subscribe();
    let mut generation = app.generation.subscribe();
    let mut pending = Vec::new();
    loop {
        tokio::select! {
            _=shutdown.changed()=>break,
            _=generation.changed()=>break,
            _=tick.tick()=>{if !app.store.valid_session(&grant.owner){break;}},
            output=rx.recv()=>{let Some(output)=output else{let code=child.try_wait().ok().flatten().map(|s|s.exit_code());let _=socket.send(Message::Text(json!({"type":"exit","exitCode":code}).to_string().into())).await;break};pending.extend(output);let (text,consumed)=decode_output(&pending);if consumed>0{pending.drain(..consumed);if tokio::time::timeout(Duration::from_secs(5),socket.send(Message::Text(json!({"type":"output","data":text}).to_string().into()))).await.map(|v|v.is_err()).unwrap_or(true){break;}}},
            input=socket.recv()=>{match input{Some(Ok(Message::Text(text)))=>{if let Ok(message)=serde_json::from_str::<Value>(&text){match s(&message,"type"){"input"=>{if let Some(data)=message["data"].as_str(){if write_tx.try_send(data.as_bytes().to_vec()).is_err(){break;}}},"resize"=>{if let (Some(cols),Some(rows))=(message["cols"].as_u64(),message["rows"].as_u64()){let _=master.resize(PtySize{cols:cols.clamp(2,500)as u16,rows:rows.clamp(2,200)as u16,pixel_width:0,pixel_height:0});}},_=>()}}},Some(Ok(Message::Ping(p)))=>{let _=socket.send(Message::Pong(p)).await;},Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>()}}
        }
    }
    drop(rx);
    drop(write_tx);
    #[cfg(unix)]
    if let Some(pid) = child.process_id() {
        // PTY shells own a process group; closing a tab must also stop its children.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = tokio::task::spawn_blocking(move || child.wait()).await;
    drop(master);
    let _ = tokio::time::timeout(Duration::from_secs(2), reader_task).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), writer_task).await;
}
fn decode_output(bytes: &[u8]) -> (String, usize) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.into(), bytes.len()),
        Err(e) if e.error_len().is_none() => (
            String::from_utf8_lossy(&bytes[..e.valid_up_to()]).into_owned(),
            e.valid_up_to(),
        ),
        Err(_) => (String::from_utf8_lossy(bytes).into_owned(), bytes.len()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_utf8() {
        let bytes = "你好".as_bytes();
        assert_eq!(decode_output(&bytes[..4]), ("你".into(), 3));
        assert_eq!(decode_output(bytes), ("你好".into(), 6));
    }
}
