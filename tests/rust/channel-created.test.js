import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

test('channel creation time survives edits, reconnects, refreshes and restart', async t => {
  const app = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
start) cat >/dev/null;;
status|list) printf '  created-test\\n    通道: 畅通\\n    开通: 2099-01-01 00:00:00\\n';;
esac
`, { mode: 0o700 });
  });
  await app.setup();
  const config = { name: 'created-test', target: 'root@example.com', auth: 'password', password: 'secret', port: 22 };
  const created = await app.api('/api/channels', config);
  assert.equal(created.response.status, 201);
  const time = created.data.channel.started;
  assert.match(time, /^\d{4}-\d{2}-\d{2} /);
  assert.notEqual(time, '2099-01-01 00:00:00');
  const edited = await app.api('/api/channels/created-test', { ...config, createdAt: '2099-01-01' }, 'PUT');
  assert.equal(edited.data.channel.started, time);
  const connected = await app.api('/api/channels/created-test?action=reconnect', {});
  assert.equal(connected.data.channel.started, time);
  const refreshed = await app.api('/api/channels/refresh', {});
  assert.equal(refreshed.data.channels[0].started, time);
  await app.restart();
  assert.equal((await app.api('/api/channels')).data.channels[0].started, time);
});
