import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { fixture } from './helpers.js';
import { decodeBackup, encodeBackup } from '../compat/backup.js';

test('Rust authentication, encrypted SQLite, platform push, backup compatibility and restart', { timeout: 60000 }, async t => {
  const f = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
list) printf '  test\n    通道: 畅通\n    保活: 在跑\n';;
status) printf '  test\n    通道: 畅通\n';;
run) printf 'SSH_HOLD_OS=Linux\nSSH_HOLD_DISTRO="Debian 12"\nSSH_HOLD_ARCH=aarch64\n';;
start) cat >/dev/null;;
stop) exit 0;;
esac
`, { mode: 0o700 });
  });
  assert.equal((await f.api('/api/channels')).response.status, 401);
  assert.deepEqual((await f.api('/api/auth/status')).data, { configured: false, authenticated: false });
  assert.equal((await f.api('/api/auth/setup', { password: 'short', confirmPassword: 'short' })).response.status, 400);
  assert.equal((await f.setup()).response.status, 200);
  assert.equal((await f.setup()).response.status, 409);
  assert.equal((await f.api('/api/channels', {}, 'POST', { headers: { origin: 'http://evil.invalid' } })).response.status, 403);
  const stream = await fetch(f.base + '/api/channels/events', { headers: { cookie: f.cookie }, signal: AbortSignal.timeout(10000) });
  const reader = stream.body.getReader(); let pending = '';
  const next = async predicate => {
    while (true) {
      const at = pending.indexOf('\n\n');
      if (at >= 0) {
        const event = pending.slice(0, at); pending = pending.slice(at + 2);
        const data = event.split('\n').find(line => line.startsWith('data: '));
        if (data) { const value = JSON.parse(data.slice(6)); if (predicate(value)) return value; }
      } else { const part = await reader.read(); assert.equal(part.done, false); pending += new TextDecoder().decode(part.value); }
    }
  };
  const created = await f.api('/api/channels', { name: 'test', target: 'root@example.com', port: 22, auth: 'password', password: 'ssh-test-secret' });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  await next(rows => rows.some(c => c.operatingSystem === 'Debian 12' && c.architecture === 'aarch64'));
  await reader.cancel();
  const db = new DatabaseSync(path.join(f.home, 'data/channels.sqlite'));
  const raw = db.prepare('SELECT config FROM channels').get().config;
  assert.equal(raw.includes('ssh-test-secret'), false); db.close();
  assert.equal((await f.api('/api/channels/test/password', { password: 'test-password' })).data.password, 'ssh-test-secret');
  assert.equal((await f.api('/api/jumpservers/enabled', { enabled: true })).response.status, 400);
  const jms = await f.api('/api/jumpservers', { name: 'test', url: 'https://jms.example.com', keyId: '00000000-0000-0000-0000-000000000001', keySecret: 'fake-secret' });
  assert.equal(jms.response.status, 201);
  assert.equal(jms.data.server.keySecret, undefined);
  assert.equal((await f.api('/api/jumpservers')).data.enabled, true);
  assert.equal((await f.api('/api/jumpservers/enabled', { enabled: false })).data.enabled, false);
  assert.equal((await f.api('/api/jumpservers')).data.enabled, false);
  assert.equal((await f.api('/api/jumpservers/enabled', { enabled: true })).data.enabled, true);
  const exportBody = { password: 'backup-password', preferences: { 'ssh-hold-theme': 'dark' } };
  const exported = await f.api('/api/settings/backup/export', exportBody);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.data));
  const payload = await decodeBackup(exported.data, exportBody.password);
  assert.equal(payload.channels[0].config.password, 'ssh-test-secret');
  const nodeBackup = await encodeBackup(payload, exportBody.password);
  assert.equal((await f.api('/api/settings/backup/import', { ...exportBody, backup: nodeBackup, confirmed: false })).response.status, 400);
  assert.equal((await f.api('/api/settings/backup/import', { password: 'wrong-password', backup: nodeBackup, confirmed: true })).response.status, 400);
  assert.equal((await f.api('/api/settings/backup/import', { ...exportBody, backup: nodeBackup, confirmed: true })).data.channels, 1);
  assert.equal((await f.api('/api/channels')).response.status, 401);
  assert.equal((await f.api('/api/auth/login', { password: 'test-password' })).response.status, 200);
  await f.restart();
  assert.equal((await f.api('/api/channels')).data.channels.length, 1);
  const oldCookie = f.cookie;
  assert.equal((await f.api('/api/auth/password', { password: 'replacement-password' })).response.status, 200);
  assert.equal((await f.api('/api/channels', undefined, 'GET', { headers: { cookie: oldCookie } })).response.status, 401);
  await f.api('/api/auth/logout', {});
  for (let i = 0; i < 5; i++) assert.equal((await f.api('/api/auth/login', { password: 'wrong-password' })).response.status, 401);
  assert.equal((await f.api('/api/auth/login', { password: 'replacement-password' })).response.status, 429);
});

test('Rust PTY WebSocket supports independent shells, resize, single-use grants and session revocation', { timeout: 30000 }, async t => {
  const f = await fixture(t, async home => {
    await mkdir(path.join(home, 'hold/test'), { recursive: true });
    await writeFile(path.join(home, 'hold/test/meta'), 'TARGET=root@example.com\nPORT=22\nAUTH=password\n');
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
shell) exec /bin/sh;;
list|status) printf '  test\n    通道: 畅通\n';;
esac
`, { mode: 0o700 });
  });
  await f.setup(); const sockets = []; t.after(() => sockets.forEach(s => s.terminate()));
  for (let i = 0; i < 2; i++) {
    const grant = await f.api('/api/terminal/test', {});
    assert.equal(grant.response.status, 200, JSON.stringify(grant.data));
    const url = f.base.replace('http:', 'ws:') + '/terminal?token=' + grant.data.token;
    const ws = new WebSocket(url, { origin: f.base, headers: { cookie: f.cookie } }); sockets.push(ws);
    let output = ''; ws.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'output') output += message.data; });
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'resize', cols: 123, rows: 31 }));
    ws.send(JSON.stringify({ type: 'input', data: `printf '\\124\\105\\122\\115${i}'; stty size\r` }));
    const deadline = Date.now() + 5000;
    while (!output.includes(`TERM${i}`) || !output.includes('31 123')) { assert.ok(Date.now() < deadline, output); await new Promise(r => setTimeout(r, 20)); }
    const reused = new WebSocket(url, { origin: f.base, headers: { cookie: f.cookie } });
    await once(reused, 'error');
  }
  const close = once(sockets[0], 'close'); sockets[0].close(); await close;
  assert.equal(sockets[1].readyState, WebSocket.OPEN);
  const closed = once(sockets[1], 'close');
  await f.api('/api/auth/logout', {}); await closed;
  assert.equal((await f.api('/api/terminal/test', {})).response.status, 401);
});

test('Rust metadata import deduplicates, rejects executable shell syntax and preserves records after restart', async t => {
  const f = await fixture(t, async home => {
    await mkdir(path.join(home, 'hold/sample'), { recursive: true });
    await mkdir(path.join(home, 'hold/unsafe'), { recursive: true });
    await writeFile(path.join(home, 'hold/sample/meta'), 'TARGET=root@example.com\nPORT=2222\nAUTH=key\nSTARTED=2026-10-29\\ 09:00:00\n');
    await writeFile(path.join(home, 'hold/unsafe/meta'), 'TARGET=$(touch nope)\nPORT=22\nAUTH=key\n');
    await writeFile(path.join(home, 'bin/ssh-hold'), '#!/bin/sh\necho "现在没有撑开的通道。"\n', { mode: 0o700 });
  });
  await f.setup();
  let rows = (await f.api('/api/channels')).data.channels;
  assert.equal(rows.length, 1); assert.equal(rows[0].target, 'root@example.com:2222');
  assert.equal(rows[0].canConnect, false);
  const reload = await f.api('/api/channels/reload', {});
  assert.equal(reload.data.imported, 1); assert.deepEqual(reload.data.skipped, ['unsafe']);
  await writeFile(path.join(f.home, 'hold/sample/meta'), 'TARGET=alice@updated.example\nPORT=2200\nAUTH=password\n');
  await f.api('/api/channels/reload', {});
  assert.equal((await f.api('/api/channels')).data.channels.length, 1);
  await f.api('/api/settings/refresh', { seconds: 5 });
  await f.restart();
  rows = (await f.api('/api/channels')).data.channels;
  assert.equal(rows[0].target, 'alice@updated.example:2200');
  assert.equal((await f.api('/api/settings/refresh')).data.seconds, 5);
});

test('Rust concurrent login cannot resurrect a session revoked by a password change', async t => {
  const f = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  });
  await f.setup();
  const request = (route, body, cookie = f.cookie) => fetch(f.base + route, {
    method: 'POST', headers: { origin: f.base, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const [login, change] = await Promise.all([
    request('/api/auth/login', { password: 'test-password' }, ''),
    request('/api/auth/password', { password: 'new-test-password' }),
  ]);
  assert.equal(change.status, 200);
  assert.ok([200, 401].includes(login.status));
  if (login.status === 200) {
    const old = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(f.base + '/api/channels', { headers: { cookie: old } })).status, 401);
  }
});
