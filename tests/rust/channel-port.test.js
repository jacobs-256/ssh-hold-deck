import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

test('manual channels preserve form string ports through create and edit and reject invalid ports', async t => {
  const app = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
start) printf '%s\\n' "$@" > "$HOME/start-args"; cat >/dev/null;;
status|list) printf '  port-test\\n    通道: 畅通\\n';;
esac
`, { mode: 0o700 });
  });
  await app.setup();
  const body = { name: 'port-test', target: 'root@example.com', auth: 'password', password: 'secret', port: '25380', note: '生产数据库' };
  const created = await app.api('/api/channels', body);
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.channel.note, body.note);
  assert.match(await readFile(path.join(app.home, 'start-args'), 'utf8'), /-p\n25380\n/);
  assert.match(created.data.channel.target, /:25380$/);
  const edited = await app.api('/api/channels/port-test', { ...body, port: '25381', note: '测试环境' }, 'PUT');
  assert.equal(edited.response.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.channel.note, '测试环境');
  assert.equal((await app.api('/api/channels/port-test', { ...body, note: 'a'.repeat(501) }, 'PUT')).response.status, 400);
  assert.match(await readFile(path.join(app.home, 'start-args'), 'utf8'), /-p\n25381\n/);
  for (const port of ['', 'invalid', '0', '65536', 1.5, null]) {
    const result = await app.api('/api/channels/port-test', { ...body, port }, 'PUT');
    assert.equal(result.response.status, 400, JSON.stringify({ port, result: result.data }));
  }
  await app.restart();
  const list = await app.api('/api/channels');
  assert.match(list.data.channels.find(channel => channel.name === 'port-test').target, /:25381$/);
  assert.equal(list.data.channels[0].note, '测试环境');
  assert.equal((await app.api('/api/channels/port-test', { ...body, note: '' }, 'PUT')).data.channel.note, '');
});
