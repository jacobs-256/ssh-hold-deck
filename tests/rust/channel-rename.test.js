import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

test('renaming a channel updates its configuration, hold metadata and rejects duplicates', async t => {
  const app = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
start) printf '%s\\n' "$@" > "$HOME/start-args"; cat >/dev/null;;
status|list) printf '  renamed-test\\n    通道: 畅通\\n';;
esac
`, { mode: 0o700 });
    await writeFile(path.join(home, 'bin/ssh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  });
  await app.setup();
  const config = { name: 'old-test', target: 'root@example.com', auth: 'password', password: 'secret', port: 22 };
  const created = await app.api('/api/channels', config);
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const started = created.data.channel.started;
  await mkdir(path.join(app.home, 'hold/old-test'), { recursive: true });
  await writeFile(path.join(app.home, 'hold/old-test/meta'), 'TARGET=root@example.com\nPORT=22\nAUTH=password\n');
  const dependent = await app.api('/api/channels', { ...config, name: 'dependent-test', jump: 'old-test' });
  assert.equal(dependent.response.status, 201, JSON.stringify(dependent.data));
  const renamed = await app.api('/api/channels/old-test', { ...config, name: 'renamed-test' }, 'PUT');
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.channel.name, 'renamed-test');
  assert.equal(renamed.data.channel.started, started);
  await access(path.join(app.home, 'hold/renamed-test/meta'));
  await assert.rejects(access(path.join(app.home, 'hold/old-test/meta')));
  assert.match(await readFile(path.join(app.home, 'start-args'), 'utf8'), /renamed-test/);
  const list = await app.api('/api/channels');
  assert.deepEqual(list.data.channels.map(channel => channel.name).sort(), ['dependent-test', 'renamed-test']);
  assert.equal(list.data.channels.find(channel => channel.name === 'dependent-test').jump, 'renamed-test');
  assert.equal((await app.api('/api/channels', { ...config, name: 'other-test' })).response.status, 201);
  const conflict = await app.api('/api/channels/other-test', { ...config, name: 'renamed-test' }, 'PUT');
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.data));
  assert.deepEqual((await app.api('/api/channels')).data.channels.map(channel => channel.name).sort(), ['dependent-test', 'other-test', 'renamed-test']);
});
