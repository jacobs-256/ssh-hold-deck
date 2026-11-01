import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { decodeBackup } from '../../src/backup.js';

test('backup APIs require authentication and confirmation; restore credentials, keys and settings atomically', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deck-backup-'));
  const child = spawn(process.execPath, ['src/server.js'], { cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', SSH_HOLD_WEB_DATA_DIR: directory, SSH_HOLD_DIR: path.join(directory, 'hold') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let db;
  try {
    const port = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(Error('Server startup timed out')), 15000);
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited ' + code)); });
    });
    const base = `http://127.0.0.1:${port}`; let cookie = '';
    const request = async (route, body, origin = base) => {
      const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { response, data: await response.json() };
    };
    const exportBody = { password: 'backup-password', preferences: { 'ssh-hold-language': 'en', channelPageSize: '50' }, desktop: { closeBehavior: 'ask', trayEnabled: true } };
    assert.equal((await request('/api/settings/backup/export', exportBody)).response.status, 401);
    const setup = await request('/api/auth/setup', { password: 'login-password', confirmPassword: 'login-password' });
    cookie = setup.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/settings/backup/export', exportBody, 'https://evil.test')).response.status, 403);
    db = new DatabaseSync(path.join(directory, 'channels.sqlite'));
    const vaultKey = crypto.createHash('sha256').update(`${os.userInfo().username}:${os.hostname()}:ssh-hold-web-v1`).digest();
    const encrypt = value => {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    };
    const identity = path.join(directory, 'original.key'), privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nbackup-private-key\n-----END OPENSSH PRIVATE KEY-----';
    await writeFile(identity, privateKey);
    const config = { target: 'root@example.com', port: 22, auth: 'key', identity };
    db.prepare('INSERT INTO channels (name, config) VALUES (?, ?)').run('production', encrypt(config));
    const jumpservers = { servers: [{ id: 'test-jms', name: 'Office', url: 'https://jms.example.com', keyId: '00000000-0000-0000-0000-000000000001', keySecret: 'jms-secret', orgId: '00000000-0000-0000-0000-000000000002', sshHost: 'jms.example.com', sshPort: 2222 }] };
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jumpservers', encrypt(jumpservers));
    await request('/api/settings/refresh', { seconds: 0 });
    const exported = await request('/api/settings/backup/export', exportBody);
    assert.equal(exported.response.status, 200);
    assert.match(exported.response.headers.get('content-disposition'), /attachment/);
    const payload = await decodeBackup(exported.data, exportBody.password);
    assert.equal(payload.channels[0].identityContent, privateKey);
    assert.deepEqual(JSON.parse(payload.settings.find(item => item.key === 'jumpservers').value), jumpservers);
    assert.equal(JSON.stringify(exported.data).includes('backup-private-key'), false);
    await rm(identity);
    await request('/api/settings/refresh', { seconds: 60 });
    const importBody = { backup: exported.data, password: exportBody.password, confirmed: true };
    assert.equal((await request('/api/settings/backup/import', { ...importBody, confirmed: false })).response.status, 400);
    assert.equal((await request('/api/settings/backup/import', { ...importBody, password: 'wrong-password' })).response.status, 400);
    assert.equal((await request('/api/settings/refresh')).data.seconds, 60);
    const restored = await request('/api/settings/backup/import', importBody);
    assert.equal(restored.response.status, 200);
    assert.deepEqual(restored.data.preferences, exportBody.preferences);
    assert.deepEqual(restored.data.desktop, exportBody.desktop);
    assert.equal((await request('/api/settings/refresh')).response.status, 401);
    const login = await request('/api/auth/login', { password: 'login-password' });
    assert.equal(login.response.status, 200); cookie = login.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/settings/refresh')).data.seconds, 0);
    const reexported = await request('/api/settings/backup/export', exportBody);
    const restoredPayload = await decodeBackup(reexported.data, exportBody.password);
    assert.deepEqual(JSON.parse(restoredPayload.settings.find(item => item.key === 'jumpservers').value), jumpservers);
    const channels = (await request('/api/channels')).data.channels;
    assert.equal(channels.length, 1); assert.notEqual(channels[0].identity, identity);
    assert.equal(await readFile(channels[0].identity, 'utf8'), privateKey);
    assert.equal((await stat(channels[0].identity)).mode & 0o777, 0o600);
    assert.equal(db.prepare('SELECT count(*) AS n FROM web_sessions').get().n, 1);
  } finally {
    db?.close();
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
