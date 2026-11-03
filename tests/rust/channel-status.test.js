import test from 'node:test';
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';

test('a delayed refresh cannot overwrite the connected state after editing a channel', async t => {
  const app = await fixture(t, async home => {
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
case "$1" in
start) cat >/dev/null;;
status) printf '  race-test\\n    通道: 畅通\\n';;
list)
  if [ -f "$HOME/delay-list" ]; then
    touch "$HOME/list-started"
    while [ ! -f "$HOME/release-list" ]; do sleep 0.05; done
    printf '  race-test\\n    通道: 已断开\\n'
  else
    printf '  race-test\\n    通道: 畅通\\n'
  fi;;
esac
`, { mode: 0o700 });
  });
  await app.setup();
  const config = { name: 'race-test', target: 'root@example.com', port: '25380', auth: 'password', password: 'secret' };
  assert.equal((await app.api('/api/channels', config)).response.status, 201);
  await writeFile(path.join(app.home, 'delay-list'), '');
  const refresh = app.api('/api/channels/refresh', {});
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      try { await access(path.join(app.home, 'list-started')); break; } catch {}
      assert(Date.now() < deadline, 'refresh must start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const edited = await app.api('/api/channels/race-test', { ...config, port: '25381' }, 'PUT');
    assert.equal(edited.response.status, 200);
    assert.equal(edited.data.channel.status, '畅通');
  } finally {
    await writeFile(path.join(app.home, 'release-list'), '');
    await refresh;
  }
  const list = await app.api('/api/channels');
  assert.equal(list.data.channels.find(channel => channel.name === 'race-test').status, '畅通');
});
