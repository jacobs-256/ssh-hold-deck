import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

test('JumpServer settings, create, reconnect, reload and deletion preserve references and never store token passwords', { timeout: 20000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hold-jms-'));
  const hold = path.join(temp, 'hold'), data = path.join(temp, 'data');
  const assetId = '11111111-1111-4111-8111-111111111111';
  const account = '22222222-2222-4222-8222-222222222222';
  const fixture = { id: assetId, name: 'Test Linux', address: '10.0.0.1', is_active: true, permed_protocols: [{ name: 'ssh', port: 2200 }], permed_accounts: [{ alias: account, name: 'Root', username: 'root', has_secret: true, actions: [{ value: 'connect' }] }] };
  await mkdir(path.join(temp, 'bin'));
  await writeFile(path.join(temp, 'upstream.mjs'), `
    import crypto from 'node:crypto';
    let sequence = 0;
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://jms.example') throw new Error('Unexpected upstream');
      if (parsed.pathname.endsWith('/profile/')) return Response.json({ username: 'tester' });
      if (parsed.pathname.endsWith('/profile/permissions/')) return Response.json({ workbench_orgs: [{ id: '00000000-0000-0000-0000-000000000002', name: 'Default', is_default: true }] });
      if (parsed.pathname.endsWith('/connection-token/')) {
        const body = JSON.parse(options.body);
        if (body.asset !== '${assetId}' || body.account !== '${account}' || body.protocol !== 'ssh' || body.connect_method !== 'ssh') return Response.json({}, { status: 400 });
        return Response.json({ id: crypto.randomUUID(), value: 'temporary-' + (++sequence), is_active: true });
      }
      if (parsed.pathname.endsWith('/${assetId}/')) return Response.json(${JSON.stringify(fixture)});
      if (parsed.pathname.endsWith('/assets/')) return Response.json({ count: 1, results: [${JSON.stringify(fixture)}] });
      return Response.json({}, { status: 404 });
    };
  `);
  await writeFile(path.join(temp, 'fake-ssh.mjs'), `#!/usr/bin/env node
    import fs from 'node:fs'; import path from 'node:path';
    const args=process.argv.slice(2), base=process.env.SSH_HOLD_DIR;
    const name=args[0]==='start'?args[args.indexOf('-n')+1]:args[1];
    if(args[0]==='start') {
      let password=''; for await(const chunk of process.stdin) password+=chunk;
      if(!/^temporary-[0-9]+$/.test(password)) process.exit(1);
      const target=args.at(-1), port=args[args.indexOf('-p')+1];
      fs.mkdirSync(path.join(base,name),{recursive:true});
      fs.writeFileSync(path.join(base,name,'meta'),'TARGET='+target+'\\nPORT='+port+'\\nAUTH=password\\nINSECURE=0\\n');
      console.log('connected');
    } else if(args[0]==='stop') fs.rmSync(path.join(base,name),{recursive:true,force:true});
    else if(args[0]==='list') console.log('现在没有撑开的通道。');
    else if(args[0]==='status') console.log('SSH 通道：\\n  '+name+'\\n    通道: 畅通\\n    保活: 在跑');
  `, { mode: 0o700 });
  await symlink(path.join(temp, 'fake-ssh.mjs'), path.join(temp, 'bin/ssh-hold'));
  const socket = net.createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['--import', path.join(temp, 'upstream.mjs'), 'src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '../..'), env: { ...process.env, PORT: String(port), SSH_HOLD_DIR: hold, SSH_HOLD_WEB_DATA_DIR: data, PATH: `${temp}/bin:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  };
  try {
    await once(child.stdout, 'data');
    assert.equal((await api('/api/channels')).status, 401);
    assert.equal((await api('/api/jumpservers')).status, 401);
    assert.equal((await api('/api/auth/setup', 'POST', { password: 'integration-test-password', confirmPassword: 'integration-test-password' })).status, 200);
    const input = { name: 'Test', url: 'https://jms.example', keyId: assetId, keySecret: 'test-secret', sshHost: 'gateway.example', sshPort: 2222 };
    const created = await api('/api/jumpservers', 'POST', input);
    assert.equal(created.status, 201);
    const saved = created.data.server, endpoint = '/api/jumpservers/' + saved.id;
    assert.equal(saved.keySecret, undefined);
    const organizations = await api('/api/jumpservers/organizations', 'POST', { ...saved, keySecret: '' });
    assert.equal(organizations.status, 200);
    assert.deepEqual(organizations.data.organizations, [{ id: '00000000-0000-0000-0000-000000000002', name: 'Default', isDefault: true }]);
    assert.equal((await api('/api/jumpservers/test', 'POST', { ...saved, keySecret: '' })).data.assetCount, 1);
    assert.equal((await api(endpoint, 'PUT', { ...saved, keySecret: '' })).status, 200);
    assert.equal((await api(endpoint, 'PUT', { ...saved, url: 'https://other.example', keySecret: '' })).status, 400);
    const blocked = await fetch(base + '/api/jumpservers', { headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403);
    assert.equal((await api(endpoint + '/assets?search=linux&offset=0')).data.results.length, 1);
    assert.equal((await api(endpoint + '/assets?offset=-1')).status, 400);
    const channel = { name: 'jms-test', source: 'jumpserver', serverId: saved.id, assetId, account };
    const [first, second, another] = await Promise.all([
      api('/api/channels', 'POST', channel),
      api('/api/channels', 'POST', channel),
      api('/api/channels', 'POST', { ...channel, name: 'jms-other' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    const opened = first.status === 201 ? first : second;
    assert.equal(another.status, 201);
    assert.equal((await api('/api/channels')).data.channels.length, 2);
    assert.equal((await api('/api/channels/jms-other', 'DELETE')).status, 200);
    assert.equal(opened.data.channel.auth, 'jumpserver');
    assert.equal(opened.data.channel.target, 'root@10.0.0.1:2200');
    assert.equal(opened.data.channel.password, undefined);
    const firstMeta = await readFile(path.join(hold, channel.name, 'meta'), 'utf8');
    assert.equal((await api('/api/channels', 'POST', channel)).status, 409);
    assert.equal((await api(endpoint, 'DELETE')).status, 409);
    assert.equal((await api('/api/channels/jms-test?action=reconnect', 'POST')).status, 200);
    assert.notEqual(await readFile(path.join(hold, channel.name, 'meta'), 'utf8'), firstMeta);
    assert.equal((await api('/api/channels/reload', 'POST')).data.channels[0].assetId, assetId);
    const db = new DatabaseSync(path.join(data, 'channels.sqlite'), { readOnly: true });
    try {
      const ciphertext = db.prepare('SELECT config FROM channels WHERE name=?').get(channel.name).config;
      assert.ok(!ciphertext.includes(assetId));
      const key = crypto.createHash('sha256').update(`${os.userInfo().username}:${os.hostname()}:ssh-hold-web-v1`).digest();
      const encrypted = JSON.parse(ciphertext), decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
      const config = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]));
      assert.equal(config.source, 'jumpserver'); assert.equal(config.account, account);
      assert.equal(config.password, undefined); assert.ok(!JSON.stringify(config).includes('temporary-'));
      assert.ok(!db.prepare("SELECT value FROM settings WHERE key='jumpservers'").get().value.includes('test-secret'));
    } finally { db.close(); }
    assert.equal((await api('/api/channels/jms-test?action=disconnect', 'POST')).data.channel.status, '已断开');
    assert.equal((await api('/api/channels/jms-test', 'DELETE')).status, 200);
    assert.equal((await api(endpoint, 'DELETE')).status, 200);
    assert.equal((await api('/api/channels')).data.channels.length, 0);
  } finally {
    child.kill(); if (child.exitCode === null) await once(child, 'exit');
    await rm(temp, { recursive: true, force: true });
  }
});
