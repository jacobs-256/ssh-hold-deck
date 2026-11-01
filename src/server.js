import { connectionAvailability } from './connection-config.js';
import { backupLimit, encodeBackup, decodeBackup } from './backup.js';
import { createAgentSkills } from './agent-skills.js';
import { jumpOptions } from './jump.js';
import { JumpServerClient, normalizeServer, publicServer } from './jumpserver.js';
import { attachTerminals } from './terminal-server.js';
import { createAuth } from './auth.js';
import { createHostKeyManager } from './host-keys.js';
import { validOrigin } from './request-origin.js';
import { cliStatus, installCli } from './cli-install.js';
import { bindService, checkPort, validPort } from './service-port.js';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, chmod, readdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let port;
const desktop = process.env.SSH_HOLD_DESKTOP === '1';
const bindHost = desktop ? '127.0.0.1' : process.env.HOST || '0.0.0.0';
const holdDir = process.env.SSH_HOLD_DIR || path.join(os.homedir(), '.ssh', 'hold');
const vaultFile = path.join(holdDir, '.web-vault');
const vaultKey = crypto.createHash('sha256').update(`${os.userInfo().username}:${os.hostname()}:ssh-hold-web-v1`).digest();

const run = (args, input = '') => new Promise((resolve) => {
  execFile('ssh-hold', args, { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, SSH_HOLD_DIR: holdDir } }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr, code: error?.code }));
});
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0, exceeded = false;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > limit) { exceeded = true; chunks.length = 0; reject(Object.assign(new Error('请求过大'), { status: 413 })); }
    else if (!exceeded) chunks.push(chunk);
  });
  req.on('error', reject);
  req.on('end', () => { if (exceeded) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('JSON 无效'), { status: 400 })); } });
});
const encrypt = (value) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', vaultKey, iv); const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]); return JSON.stringify({ iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }); };
const decrypt = (raw) => { try { const x = JSON.parse(raw); const d = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(x.iv, 'base64')); d.setAuthTag(Buffer.from(x.tag, 'base64')); return JSON.parse(Buffer.concat([d.update(Buffer.from(x.data, 'base64')), d.final()]).toString()); } catch { return {}; } };
const dataDir = process.env.SSH_HOLD_WEB_DATA_DIR || path.join(root, 'data');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const dbFile = path.join(dataDir, 'channels.sqlite');
const db = new DatabaseSync(dbFile);
await chmod(dbFile, 0o600);
db.exec('CREATE TABLE IF NOT EXISTS channels (name TEXT PRIMARY KEY, config TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS channel_status (name TEXT PRIMARY KEY, snapshot TEXT NOT NULL)');
const savedService=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='service'").get()?.value||'{}');
let configuredPort=Number(process.env.PORT || savedService.port || (desktop ? 0 : 8787));
let autoSelectPort=desktop || savedService.autoSelect===true;
let restarting=false;
const auth = createAuth(db);
async function loadVault() { return Object.fromEntries(db.prepare('SELECT name, config FROM channels').all().map(row => [row.name, decrypt(row.config)])); }
function loadJumpServers() { const row = db.prepare("SELECT value FROM settings WHERE key = 'jumpservers'").get(); return row ? decrypt(row.value).servers || [] : []; }
function saveJumpServers(servers) { db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jumpservers', encrypt({ servers })); }
function jumpServer(id) { const server = loadJumpServers().find(s => s.id === id); if (!server) throw new Error('JumpServer 配置不存在，请先配置堡垒机'); return server; }
function displayChannel(config) { return { source: config.source || 'manual', serverId: config.serverId, assetId: config.assetId, assetName: config.assetName, assetAddress: config.assetAddress, account: config.account, accountUsername: config.accountUsername, serverName: config.source === 'jumpserver' ? loadJumpServers().find(s => s.id === config.serverId)?.name || '配置已移除' : '' }; }
async function channelConfig(input, previous = {}) {
  if (input.source === 'jumpserver') return new JumpServerClient(jumpServer(input.serverId)).channel(input);
  if (input.source && input.source !== 'manual') throw new Error('连接来源无效');
  const config = { source: 'manual', jump: input.jump || '', target: input.target, port: Number(input.port || 22), insecure: Boolean(input.insecure), auth: input.auth || 'password', identity: input.identity ?? previous.identity ?? '', password: input.password || previous.password || '' };
  const availability = connectionAvailability(config);
  if (!availability.canConnect) throw new Error(availability.connectDisabledReason);
  return config;
}
const channelOperations = new Set();
function saveChannel(name, config) { db.prepare('INSERT OR REPLACE INTO channels (name, config) VALUES (?, ?)').run(name, encrypt(config)); }
async function saveVault(v) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM channels');
    const insert = db.prepare('INSERT INTO channels (name, config) VALUES (?, ?)');
    for (const [name, config] of Object.entries(v)) insert.run(name, encrypt(config));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
// Parse shell-escaped scalar values without sourcing executable metadata.
function metaValue(value) {
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
  if (value.startsWith("$'") || value.startsWith('"')) throw new Error('不支持的元数据转义格式');
  return value.replace(/\\(.)/g, '$1');
}
async function importChannels() {
  let imported = 0; const skipped = [];
  const entries = await readdir(holdDir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9._-]+$/.test(entry.name)) continue;
    try {
      const raw = await readFile(path.join(holdDir, entry.name, 'meta'), 'utf8');
      if (channelOperations.has(entry.name)) continue;
      const meta = Object.fromEntries(raw.split('\n').filter(line => /^[A-Z]+=/.test(line)).map(line => { const at = line.indexOf('='); return [line.slice(0, at), metaValue(line.slice(at + 1))]; }));
      if (!/^[^\s@]+@[^\s@]+$/.test(meta.TARGET || '') || !Number.isInteger(Number(meta.PORT)) || Number(meta.PORT) < 1 || Number(meta.PORT) > 65535) throw new Error('无效连接信息');
      const row = db.prepare('SELECT config FROM channels WHERE name = ?').get(entry.name);
      const saved = row ? decrypt(row.config) : {};
      const config = saved.source === 'jumpserver' ? { ...saved, started: meta.STARTED || '' } : { ...saved, target: meta.TARGET, port: Number(meta.PORT), auth: meta.AUTH === 'key' ? 'key' : 'password', insecure: meta.INSECURE === '1', started: meta.STARTED || '' };
      saveChannel(entry.name, config);
      imported++;
    } catch (error) { if (error.code !== 'ENOENT') skipped.push(entry.name); }
  }
  return { imported, skipped };
}
if (!db.prepare("SELECT value FROM settings WHERE key = 'initialized'").get()) {
  let legacy = {};
  try { legacy = decrypt(await readFile(vaultFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await saveVault(legacy);
  await importChannels();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('initialized', '1');
}
function parseList(text) { const out = []; let current; for (const line of text.split('\n')) { const m = line.match(/^  (\S.*)$/); if (m) { current = { name: m[1].trim() }; out.push(current); continue; } if (!current) continue; const kv = line.match(/^    ([^:]+):\s?(.*)$/); if (!kv) continue; const k = { '目标':'target', '开通':'started', '通道':'status', '保活':'keepalive', '远端':'remote' }[kv[1]]; if (k) current[k] = kv[2]; } return out; }
async function channels() { const live = new Map(db.prepare('SELECT name, snapshot FROM channel_status').all().map(row => [row.name, JSON.parse(row.snapshot)])); const vault = await loadVault(); return Object.entries(vault).map(([name, saved]) => ({ name, started: saved.started || '', status: '未知', keepalive: '未知', ...live.get(name), target: `${saved.target}:${saved.port || 22}`, auth: saved.auth || 'unknown', identity: saved.identity || '', insecure: Boolean(saved.insecure), jump: saved.jump || '', ...displayChannel(saved), ...connectionAvailability(saved) })); }
let statusRefresh;
let refreshSeconds = Number(db.prepare("SELECT value FROM settings WHERE key = 'refreshSeconds'").get()?.value || 30);
let refreshTimer;
const statusClients = new Set();
async function publishChannels() {
  if (!statusClients.size) return;
  const message = `event: channels\ndata: ${JSON.stringify(await channels())}\n\n`;
  for (const client of statusClients) {
    if (!auth.session(client.req)) { client.res.end(); continue; }
    if (!client.res.write(message)) client.res.end();
  }
}
function scheduleRefresh() {
  clearInterval(refreshTimer);
  if (refreshSeconds === 0) return;
  refreshTimer = setInterval(() => refreshStatuses().catch(error => console.error('状态更新失败:', error.message)), refreshSeconds * 1000);
  refreshTimer.unref();
}
function refreshStatuses() {
  if (statusRefresh) return statusRefresh;
  statusRefresh = (async () => {
    const result = await run(['list']);
    if (!result.ok) throw new Error(result.stderr || '读取通道状态失败');
    const live = new Map(parseList(result.stdout).map(channel => [channel.name, channel]));
    const update = db.prepare('INSERT OR REPLACE INTO channel_status (name, snapshot) VALUES (?, ?)');
    let changed = false;
    for (const row of db.prepare('SELECT name FROM channels').all()) {
      if (channelOperations.has(row.name)) continue;
      const snapshot = live.get(row.name) || { status: '已断开', keepalive: '停了' };
      const previous = JSON.parse(db.prepare('SELECT snapshot FROM channel_status WHERE name = ?').get(row.name)?.snapshot || '{}');
      delete previous.checkedAt;
      if (JSON.stringify(previous) !== JSON.stringify(snapshot)) changed = true;
      update.run(row.name, JSON.stringify({ ...snapshot, checkedAt: new Date().toISOString() }));
    }
    if (changed) await publishChannels();
  })().finally(() => { statusRefresh = undefined; });
  return statusRefresh;
}
async function resolveConnection(config) { return config.source === 'jumpserver' ? new JumpServerClient(jumpServer(config.serverId)).resolve(config) : config; }
const hostKeys = createHostKeyManager();
async function startChannel(config, resolved, session) {
  const body = resolved || await resolveConnection(config);
  const proxy = await jumpOptions(body, await loadVault(), holdDir);
  const result = await new Promise(resolve => {
    const args = ['start', '-n', body.name, '-p', String(body.port || 22), '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1'];
    if (body.insecure) args.push('--insecure');
    if (body.auth === 'key') args.push('-i', body.identity); else args.push('--password-stdin');
    args.push(...proxy, body.target);
    const child = spawn('ssh-hold', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SSH_HOLD_DIR: holdDir } });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }, 45000);
    const redact = text => config.source === 'jumpserver' ? text.split(body.password).join('[redacted]') : text;
    child.stdin.on('error', () => {});
    child.stdout.on('data', d => { stdout = (stdout + d).slice(-65536); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-65536); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, stderr: '无法启动 ssh-hold，请检查本机安装' }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, stdout: redact(stdout), stderr: timedOut ? 'SSH 连接超时，请检查网关地址、端口和访问策略' : redact(stderr) }); });
    child.stdin.end(body.auth === 'key' ? '' : body.password || '');
  });
  if (!result.ok) {
    const hostKeyChallenge = await hostKeys.challenge(result.stderr || '', body, proxy, session).catch(() => null);
    if (hostKeyChallenge) throw Object.assign(new Error('SSH 主机指纹已变化，请核实后确认信任'), { hostKeyChallenge });
  }
  return result;
}
async function channelResult(name, config) {
  const result = await run(['status', name]);
  const current = parseList(result.stdout)[0] || { name, status: '畅通' };
  db.prepare('INSERT OR REPLACE INTO channel_status (name, snapshot) VALUES (?, ?)').run(name, JSON.stringify({ ...current, checkedAt: new Date().toISOString() }));
  return { ...current, target: `${config.target}:${config.port || 22}`, auth: config.auth, identity: config.identity || '', insecure: Boolean(config.insecure), jump: config.jump || '', ...displayChannel(config), ...connectionAvailability(config) };
}
async function stopIfPresent(name) {
  if (!existsSync(path.join(holdDir, name, 'meta'))) return { ok: true };
  return run(['stop', name]);
}
async function storeIdentity(body) {
  if (body.auth !== 'key' || !body.identityContent) return;
  if (typeof body.identityContent !== 'string' || Buffer.byteLength(body.identityContent) > 65536 || !/-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(body.identityContent)) throw new Error('请选择有效的 SSH 私钥文件（最大 64KB）');
  const directory = path.join(dataDir, 'keys');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${crypto.randomUUID()}.key`);
  await writeFile(file, body.identityContent, { mode: 0o600, flag: 'wx' });
  body.identity = file;
  delete body.identityContent;
}

const agentSkills = process.env.SSH_HOLD_WINDOWS_HOME ? createAgentSkills({
  home: process.env.SSH_HOLD_WINDOWS_HOME,
  env: { PATH: '' }, platform: 'win32', applications: [],
}) : createAgentSkills();
function reportDesktopReady() {
  if (desktop) console.log('SSH_HOLD_DESKTOP_READY ' + JSON.stringify({ port, token: process.env.SSH_HOLD_DESKTOP_TOKEN }));
}
const requestHandler = async (req, res) => {
  let operationName;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/') && !validOrigin(req)) return json(res, 403, { error: '请求来源无效' });
    if (url.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { configured: auth.configured(), authenticated: Boolean(auth.session(req)) });
    if (['/api/auth/setup', '/api/auth/login'].includes(url.pathname) && req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname.endsWith('/setup')) await auth.setup(req, res, body); else await auth.login(req, res, body);
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/') && !auth.session(req)) return json(res, 401, { error: '请先登录', setupRequired: !auth.configured() });
    if (url.pathname === '/api/settings/backup/export' && req.method === 'POST') {
      if (!validOrigin(req, true)) return json(res, 403, { error: '请求来源无效' });
      const body = await readBody(req);
      const payload = { version: 1, createdAt: new Date().toISOString(), channels: [], settings: [], preferences: body.preferences || {}, desktop: body.desktop || null };
      for (const row of db.prepare('SELECT name, config FROM channels ORDER BY name').all()) payload.channels.push({ name: row.name, config: decrypt(row.config) });
      for (const row of db.prepare('SELECT key, value FROM settings').all()) payload.settings.push({ ...row, value: row.key === 'jumpservers' ? JSON.stringify(decrypt(row.value)) : row.value });
      for (const item of payload.channels) {
        if (item.config.auth === 'key') {
          try { item.identityContent = await readFile(item.config.identity, 'utf8'); }
          catch { throw Object.assign(new Error('无法读取通道私钥，备份已取消：' + item.name), { status: 400 }); }
        }
      }
      const backup = await encodeBackup(payload, body.password);
      if (!auth.session(req)) return json(res, 401, { error: '请先登录' });
      if (Buffer.byteLength(JSON.stringify(backup)) > backupLimit - 2048) return json(res, 413, { error: '备份文件过大（最大 20MB）' });
      res.setHeader('Content-Disposition', `attachment; filename="ssh-hold-deck-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      return json(res, 200, backup);
    }
    if (url.pathname === '/api/settings/backup/import' && req.method === 'POST') {
      if (!validOrigin(req, true)) return json(res, 403, { error: '请求来源无效' });
      const body = await readBody(req, backupLimit);
      if (body.confirmed !== true) return json(res, 400, { error: '请确认覆盖现有配置' });
      const payload = await decodeBackup(body.backup, body.password);
      if (channelOperations.size || restarting) return json(res, 409, { error: '存在进行中的操作，请稍后重试' });
      const files = [];
      try {
        for (const item of payload.channels) {
          if (item.config.auth === 'key') {
            const identity = { auth: 'key', identityContent: item.identityContent };
            await storeIdentity(identity); files.push(identity.identity); item.config.identity = identity.identity;
          }
        }
        if (!auth.session(req)) throw Object.assign(new Error('请先登录'), { status: 401 });
        if (channelOperations.size || restarting) throw Object.assign(new Error('存在进行中的操作，请稍后重试'), { status: 409 });
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec('DELETE FROM channels; DELETE FROM channel_status; DELETE FROM settings; DELETE FROM web_sessions');
          for (const item of payload.channels) saveChannel(item.name, item.config);
          for (const item of payload.settings) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(item.key, item.key === 'jumpservers' ? encrypt(JSON.parse(item.value)) : item.value);
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('initialized', '1')").run();
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } catch (error) { await Promise.all(files.map(file => rm(file, { force: true }))); throw error; }
      refreshSeconds = Number(payload.settings.find(item => item.key === 'refreshSeconds')?.value ?? 30);
      scheduleRefresh();
      for (const client of statusClients) client.res.end(); statusClients.clear();
      return json(res, 200, { ok: true, channels: payload.channels.length, preferences: payload.preferences, desktop: payload.desktop, restartRequired: true });
    }
    if(url.pathname==='/api/settings/service'&&req.method==='GET')return json(res,200,{port:configuredPort,activePort:port,autoSelect:autoSelectPort});
    if(url.pathname==='/api/settings/service/check'&&req.method==='POST') {
      if(!validOrigin(req,true))return json(res,403,{error:'请求来源无效'});
      const body=await readBody(req);return json(res,200,await checkPort(body.port,bindHost,port));
    }
    if(url.pathname==='/api/settings/service'&&req.method==='POST') {
      if(!validOrigin(req,true))return json(res,403,{error:'请求来源无效'});
      const body=await readBody(req);
      if(!validPort(body.port)||typeof body.autoSelect!=='boolean')return json(res,400,{error:'服务端口必须为 1024–65535 的整数'});
      if(restarting)return json(res,409,{error:'服务正在重启，请稍后重试'});
      restarting=true;let replacement;
      try {
        const inspection=await checkPort(body.port,bindHost,port);
        if(!inspection.available&&!body.autoSelect)return json(res,409,{error:'端口已被占用',...inspection});
        const previous=server,previousTerminals=terminals;
        let activePort=port;
        if(body.port!==port) {
          replacement=http.createServer(requestHandler);
          activePort=await bindService(replacement,body.port,bindHost,body.autoSelect);
        }
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('service',?)").run(JSON.stringify({port:body.port,autoSelect:body.autoSelect}));
        configuredPort=body.port;autoSelectPort=body.autoSelect;
        if(replacement){server=replacement;port=activePort;terminals=attachTerminals(server,{channels,run,holdDir,session:req=>auth.session(req)});}
        if(replacement) reportDesktopReady();
        res.once('finish',()=>{
          for(const client of statusClients)client.res.end();statusClients.clear();
          previousTerminals.close();
          previous.close(async()=>{
            if(!replacement){
              try{port=await bindService(server,configuredPort,bindHost,autoSelectPort);terminals=attachTerminals(server,{channels,run,holdDir,session:req=>auth.session(req)});}
              catch(error){console.error('服务重启失败:',error);}
            }
            console.log(`SSH Hold Deck: http://${bindHost}:${port}`);
            reportDesktopReady();
          });
          previous.closeAllConnections();
        });
        return json(res,200,{port:configuredPort,activePort,autoSelect:autoSelectPort,restarting:true});
      }catch(error){if(replacement?.listening)replacement.close();throw error;}
      finally{restarting=false;}
    }
    if (url.pathname === '/api/system/agent-skills' && req.method === 'GET') return json(res, 200, await agentSkills.list());
    const agentSkillMatch = url.pathname.match(/^\/api\/system\/agent-skills\/([a-z-]+)$/);
    if (agentSkillMatch && ['POST', 'DELETE'].includes(req.method)) {
      if (!validOrigin(req, true)) return json(res, 403, { error: '请求来源无效' });
      const body = await readBody(req);
      return json(res, 200, await agentSkills.change(agentSkillMatch[1], req.method === 'POST', { confirmed: body.confirmed === true }));
    }
    if (url.pathname === '/api/system/ssh-hold' && req.method === 'GET') return json(res, 200, await cliStatus());
    if (url.pathname === '/api/system/ssh-hold/install' && req.method === 'POST') {
      if (!validOrigin(req, true)) return json(res, 403, {error:'请求来源无效'});
      return json(res, 200, await installCli());
    }
    if (url.pathname === '/api/host-keys/trust' && req.method === 'POST') {
      const { token } = await readBody(req);
      await hostKeys.trust(token, auth.session(req));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/refresh') {
      if (req.method === 'GET') return json(res, 200, { seconds: refreshSeconds });
      if (req.method === 'POST') {
        const { seconds } = await readBody(req);
        if (![0,5,10,30,60].includes(seconds)) return json(res, 400, { error: '请选择有效的刷新间隔' });
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('refreshSeconds', ?)").run(String(seconds));
        refreshSeconds = seconds; scheduleRefresh();
        return json(res, 200, { seconds: refreshSeconds });
      }
    }
    if (url.pathname === '/api/channels/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
      res.write(`retry: 3000\nevent: channels\ndata: ${JSON.stringify(await channels())}\n\n`);
      const client = { req, res }; statusClients.add(client);
      const heartbeat = setInterval(() => { if (!auth.session(req)) res.end(); else if (!res.write(': heartbeat\n\n')) res.end(); }, 15000);
      res.on('close', () => { clearInterval(heartbeat); statusClients.delete(client); });
      return;
    }
    if (url.pathname === '/api/auth/password' && req.method === 'POST') {
      await auth.change(req, res, await readBody(req));
      terminals.revokeInvalid();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') { auth.logout(req, res); terminals.revokeInvalid(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/jumpservers') {
      if (req.method === 'GET') return json(res, 200, { servers: loadJumpServers().map(publicServer) });
      if (req.method === 'POST') {
        const config = normalizeServer(await readBody(req));
        saveJumpServers([...loadJumpServers(), config]);
        return json(res, 201, { server: publicServer(config) });
      }
    }
    if (['/api/jumpservers/test', '/api/jumpservers/organizations'].includes(url.pathname) && req.method === 'POST') {
      const input = await readBody(req);
      const config = normalizeServer(input, input.id ? jumpServer(input.id) : {});
      const client = new JumpServerClient(config);
      return json(res, 200, url.pathname.endsWith('/organizations') ? { organizations: await client.organizations() } : await client.test());
    }
    const jmsMatch = url.pathname.match(/^\/api\/jumpservers\/([0-9a-f-]+)(?:\/(assets)(?:\/([0-9a-f-]+))?)?$/i);
    if (jmsMatch) {
      const [, id, assets, assetId] = jmsMatch;
      const config = jumpServer(id);
      if (assets && req.method === 'GET') {
        const client = new JumpServerClient(config);
        if (assetId) return json(res, 200, { asset: await client.asset(assetId) });
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: '分页参数无效' });
        return json(res, 200, await client.assets((url.searchParams.get('search') || '').slice(0, 200), offset));
      }
      if (!assets && req.method === 'PUT') {
        const updated = normalizeServer(await readBody(req), config);
        saveJumpServers(loadJumpServers().map(s => s.id === id ? updated : s));
        return json(res, 200, { server: publicServer(updated) });
      }
      if (!assets && req.method === 'DELETE') {
        if (Object.values(await loadVault()).some(c => c.serverId === id)) return json(res, 409, { error: '该 JumpServer 仍被通道使用，请先修改或删除相关通道' });
        saveJumpServers(loadJumpServers().filter(s => s.id !== id));
        return json(res, 200, { ok: true });
      }
    }
    const terminalMatch = url.pathname.match(/^\/api\/terminal\/([A-Za-z0-9._-]+)$/);
    if (terminalMatch && req.method === 'POST') { try {return json(res, 200, {token:await terminals.issue(req, terminalMatch[1])});}catch(error){return json(res, 400, {error:error.message});} }
    const vendorFiles = {
      '/vendor/xterm.js':['@xterm/xterm/lib/xterm.js','text/javascript'],
      '/vendor/xterm.css':['@xterm/xterm/css/xterm.css','text/css'],
      '/vendor/fit.js':['@xterm/addon-fit/lib/addon-fit.js','text/javascript'],
      '/vendor/lucide.js':['lucide/dist/umd/lucide.js','text/javascript'],
      '/vendor/marked.js':['marked/lib/marked.umd.js','text/javascript'],
      '/vendor/purify.js':['dompurify/dist/purify.min.js','text/javascript'],
      '/terminal.js':['../public/terminal.js','text/javascript']
    };
    if(vendorFiles[url.pathname]){const [file,type]=vendorFiles[url.pathname];res.writeHead(200,{'content-type':type});return res.end(await readFile(path.join(root,'node_modules',file)));}
    if (url.pathname === '/api/channels' && req.method === 'GET') return json(res, 200, { channels: await channels() });
    if (url.pathname === '/api/channels/refresh' && req.method === 'POST') { await refreshStatuses(); return json(res, 200, { channels: await channels() }); }
    if (url.pathname === '/api/channels/reload' && req.method === 'POST') { const result = await importChannels(); await publishChannels(); return json(res, 200, { ...result, channels: await channels() }); }
    if (url.pathname === '/api/channels' && req.method === 'POST') {
      const b = await readBody(req);
      if (!/^[A-Za-z0-9._-]+$/.test(b.name || '')) return json(res, 400, { error: '通道名称无效' });
      if (channelOperations.has(b.name)) return json(res, 409, { error: '该通道正在连接或更新，请稍后重试' });
      operationName = b.name; channelOperations.add(operationName);
      if ((await loadVault())[b.name] || existsSync(path.join(holdDir, b.name, 'meta'))) return json(res, 409, { error: '通道名称已存在，请使用其他名称' });
      await storeIdentity(b);
      const config = await channelConfig(b);
      const r = await startChannel({ ...config, name: b.name }, undefined, auth.session(req));
      if (!r.ok) return json(res, 400, { error: r.stderr || r.stdout || '连接失败' });
      saveChannel(b.name, config);
      return json(res, 201, { ok: true, channel: await channelResult(b.name, config) });
    }
    const match = url.pathname.match(/^\/api\/channels\/([^/]+)$/); if (match) { const name = decodeURIComponent(match[1]);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: '通道名无效' });
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (channelOperations.has(name)) return json(res, 409, { error: '该通道正在连接或更新，请稍后重试' });
        operationName = name; channelOperations.add(name);
      }
      if (req.method === 'POST' && url.searchParams.get('action') === 'disconnect') {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: '通道名无效' });
        const channel = (await channels()).find(x => x.name === name);
        if (!channel) return json(res, 404, { error: '通道不存在' });
        const result = await stopIfPresent(name);
        if (!result.ok) return json(res, 400, { error: result.stderr || '断开失败' });
        const snapshot = { status: '已断开', keepalive: '停了', remote: '', checkedAt: new Date().toISOString() };
        db.prepare('INSERT OR REPLACE INTO channel_status (name, snapshot) VALUES (?, ?)').run(name, JSON.stringify(snapshot));
        return json(res, 200, { ok: true, channel: { ...channel, ...snapshot } });
      }
      if (req.method === 'DELETE') { const r = await stopIfPresent(name); if (!r.ok) return json(res, 400, { error: r.stderr || '删除失败' }); db.prepare('DELETE FROM channels WHERE name = ?').run(name); db.prepare('DELETE FROM channel_status WHERE name = ?').run(name); return json(res, 200, { ok: true }); }
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const existing = (await channels()).some(x => x.name === name);
        if (!existing) return json(res, 404, { error: '通道不存在' });
        await storeIdentity(b);
        const v = await loadVault(); const old = v[name] || {};
        v[name] = await channelConfig(b, old);
        const config = v[name];
        if (config.auth === 'password' && !config.password || config.auth === 'key' && !config.identity) return json(res, 400, { error: '请填写密码或私钥路径后再保存连接' });
        await jumpOptions({ ...config, name }, v, holdDir);
        const resolved = await resolveConnection({ ...config, name });
        saveChannel(name, config);
        const stopped = await stopIfPresent(name);
        if (!stopped.ok) return json(res, 400, { error: stopped.stderr || '关闭旧连接失败' });
        const connected = await startChannel({ ...config, name }, resolved, auth.session(req));
        if (!connected.ok) return json(res, 400, { error: connected.stderr || connected.stdout || '配置已保存，但连接失败，请检查认证信息后重试' });
        return json(res, 200, { ok: true, channel: await channelResult(name, config) });
      }
      if (req.method === 'POST' && url.searchParams.get('action') === 'reconnect') { const v = await loadVault(); const current = (await channels()).find(x => x.name === name); if (!current) return json(res, 404, { error: '通道不存在' }); const [target, port = '22'] = (current.target || '').split(/:(?=\d+$)/); const c = { name, target, port, ...(v[name] || {}) }; const availability = connectionAvailability(c); if (!availability.canConnect) return json(res, 400, { error: availability.connectDisabledReason }); await jumpOptions(c, v, holdDir); const resolved = await resolveConnection(c); const stop = await stopIfPresent(name); if (!stop.ok && !/没有名为/.test(stop.stderr)) return json(res, 400, { error: stop.stderr }); const r = await startChannel(c, resolved, auth.session(req)); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, channel: await channelResult(name, c) } : { error: r.stderr || r.stdout || '重连失败' }); }
    }
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(await readFile(path.join(root, 'public', 'index.html'))); }
    if (['/app.js', '/dashboard.js', '/jumpserver-ui.js', '/auth-ui.js', '/i18n.js'].includes(url.pathname)) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(await readFile(path.join(root, 'public', url.pathname.slice(1)))); }
    if (url.pathname.startsWith('/assets/')) { const file = path.join(root, 'public', url.pathname); if (!existsSync(file)) return json(res, 404, { error: 'Not found' }); const type = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream'; res.writeHead(200, { 'content-type': type }); return res.end(await readFile(file)); }
    json(res, 404, { error: 'Not found' });
  } catch (e) { json(res, e.status || 400, { error: e.message, ...(e.hostKeyChallenge ? { hostKeyChallenge: e.hostKeyChallenge } : {}) }); }
  finally { if (operationName) { channelOperations.delete(operationName); publishChannels().catch(console.error); } }
};
let server=http.createServer(requestHandler);
let terminals = attachTerminals(server, {channels,run,holdDir, session: req => auth.session(req)});
port=await bindService(server,configuredPort,bindHost,autoSelectPort);
console.log(`SSH Hold Deck: http://${bindHost}:${port}`);
reportDesktopReady();
setImmediate(() => refreshStatuses().catch(error => console.error('状态更新失败:', error.message)));
scheduleRefresh();

export async function shutdown() {
  clearTimeout(refreshTimer);
  terminals.close();
  for (const client of statusClients) client.res.end();
  statusClients.clear();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  db.close();
}
