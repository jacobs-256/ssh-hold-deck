import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { validOrigin } from './request-origin.js';

export function attachTerminals(server, { channels, run, holdDir, session = () => 'local' }) {
  const tokens = new Map();
  const sessions = new Set();
  const clients = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  function sameOrigin(req) {
    return validOrigin(req, true);
  }
  async function issue(req, name) {
    const owner = session(req);
    if (!owner) throw new Error('请先登录');
    if (!sameOrigin(req)) throw new Error('终端请求来源无效');
    if (!(await channels()).some(channel => channel.name === name) || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('通道不存在');
    const status = await run(['status', name]);
    if (!status.ok || !status.stdout.includes('通道: 畅通')) throw new Error('请先连接该通道');
    const token = crypto.randomBytes(32).toString('hex');
    if (session(req) !== owner) throw new Error('登录状态已失效');
    tokens.set(token, {name, owner, expires:Date.now()+30000});
    return token;
  }
  const upgrade = (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const grant = tokens.get(token);
    tokens.delete(token);
    if (url.pathname !== '/terminal' || !sameOrigin(req) || !grant || !session(req) || session(req) !== grant.owner || grant.expires < Date.now() || sessions.size >= 24) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      let shell;
      try { shell = pty.spawn('ssh-hold', ['shell', grant.name], { name:'xterm-256color', cols:100, rows:28, cwd:process.env.HOME, env:{...process.env, SSH_HOLD_DIR:holdDir, TERM:'xterm-256color'} }); }
      catch { ws.send(JSON.stringify({type:'error',message:'终端启动失败'})); ws.close(); return; }
      sessions.add(shell);
      clients.set(ws, req);
      const output = shell.onData(data => { if (ws.readyState === 1) { if(ws.bufferedAmount>4*1024*1024){ws.close();return;} ws.send(JSON.stringify({type:'output',data})); } });
      shell.onExit(({exitCode}) => { sessions.delete(shell); output.dispose(); if(ws.readyState===1){ws.send(JSON.stringify({type:'exit',exitCode}));ws.close();} });
      ws.on('message', raw => { try {const message=JSON.parse(raw.toString());if(message.type==='input'&&typeof message.data==='string')shell.write(message.data);if(message.type==='resize'&&Number.isInteger(message.cols)&&Number.isInteger(message.rows))shell.resize(Math.max(2,Math.min(500,message.cols)),Math.max(2,Math.min(200,message.rows)));}catch{} });
      ws.on('close',()=>{clients.delete(ws);sessions.delete(shell);output.dispose();try{shell.kill();}catch{}});
      ws.on('error',()=>ws.close());
      ws.send(JSON.stringify({type:'ready'}));
    });
  };
  server.on('upgrade',upgrade);
  const tokenTimer=setInterval(()=>{for(const [token,grant]of tokens)if(grant.expires<Date.now())tokens.delete(token);},30000);tokenTimer.unref();
  function revokeInvalid() { for (const [ws, req] of clients) if (!session(req)) ws.close(1008, 'Session expired'); }
  const sessionTimer=setInterval(revokeInvalid,30000);sessionTimer.unref();
  function close() {
    clearInterval(tokenTimer);clearInterval(sessionTimer);tokens.clear();server.off('upgrade',upgrade);
    for(const ws of clients.keys())ws.terminate();
    for(const shell of sessions){try{shell.kill();}catch{}}
    sessions.clear();clients.clear();wss.close();
  }
  return {issue, revokeInvalid, close};
}
