import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './helpers.js';

const legacyKey = () => crypto.createHash('sha256').update(`${os.userInfo().username}:${os.hostname()}:ssh-hold-web-v1`).digest();

function seal(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

test('records written with the legacy host-derived key stay readable without a key file', async t => {
  const key = legacyKey();
  const config = { name: 'legacy-test', target: 'legacy@example.com', port: 22, auth: 'password', password: 'secret' };
  const app = await fixture(t, async home => {
    await mkdir(path.join(home, 'data'), { recursive: true });
    const db = new DatabaseSync(path.join(home, 'data/channels.sqlite'));
    db.exec('CREATE TABLE channels(name TEXT PRIMARY KEY,config TEXT NOT NULL)');
    db.prepare('INSERT INTO channels(name,config) VALUES(?,?)').run('legacy-test', seal(config, key));
    db.close();
  });
  await app.setup();
  const list = await app.api('/api/channels');
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.channels.length, 1);
  assert.equal(list.data.channels[0].name, 'legacy-test');
  assert.equal(list.data.channels[0].target, 'legacy@example.com:22');
  assert.equal(await readFile(path.join(app.home, 'data/vault.key'), 'utf8'), key.toString('hex'));
});

test('a manual legacy identity recovers records after a random vault key was written', async t => {
  const user = 'olduser';
  const host = 'old-mac.local';
  const key = crypto.createHash('sha256').update(`${user}:${host}:ssh-hold-web-v1`).digest();
  const config = { name: 'legacy-manual', target: 'legacy@example.com', port: 22, auth: 'password', password: 'secret' };
  const app = await fixture(t, async home => {
    await mkdir(path.join(home, 'data'), { recursive: true });
    const db = new DatabaseSync(path.join(home, 'data/channels.sqlite'));
    db.exec('CREATE TABLE channels(name TEXT PRIMARY KEY,config TEXT NOT NULL)');
    db.prepare('INSERT INTO channels(name,config) VALUES(?,?)').run('legacy-manual', seal(config, key));
    db.close();
    await writeFile(path.join(home, 'data/vault.key'), '22'.repeat(32));
    await writeFile(path.join(home, 'data/legacy-identity.txt'), `${user}:${host}\n`);
  });
  await app.setup();
  const list = await app.api('/api/channels');
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.channels[0].target, 'legacy@example.com:22');
  assert.equal(await readFile(path.join(app.home, 'data/vault.key'), 'utf8'), key.toString('hex'));
});

test('an unreadable vault key does not stop the service and its records can be replaced', async t => {
  const app = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
start) cat >/dev/null;;
status|list) printf '  broken-test\\n    通道: 畅通\\n';;
esac
`, { mode: 0o700 });
  });
  await app.setup();
  const config = { name: 'broken-test', target: 'root@example.com', auth: 'password', password: 'secret', port: 22 };
  assert.equal((await app.api('/api/channels', config)).response.status, 201);
  await writeFile(path.join(app.home, 'data/vault.key'), '11'.repeat(32));
  await app.restart();
  const list = await app.api('/api/channels');
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.channels.length, 1);
  assert.equal(list.data.channels[0].undecryptable, true);
  assert.equal(list.data.channels[0].canConnect, false);
  const removed = await app.api('/api/channels/broken-test', undefined, 'DELETE');
  assert.equal(removed.response.status, 200, JSON.stringify(removed.data));
  const recreated = await app.api('/api/channels', config);
  assert.equal(recreated.response.status, 201, JSON.stringify(recreated.data));
  const after = await app.api('/api/channels');
  assert.equal(after.data.channels.length, 1);
  assert.equal(after.data.channels[0].undecryptable, undefined);
  assert.equal(after.data.channels[0].target, 'root@example.com:22');
});
