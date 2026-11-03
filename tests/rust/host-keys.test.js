import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fixture } from './helpers.js';

test('Rust fingerprint confirmation verifies the captured key and preserves unrelated known_hosts entries', async t => {
  let oldKey, newKey, original, fingerprint;
  const f = await fixture(t, async home => {
    await mkdir(path.join(home, '.ssh'));
    for (const name of ['old', 'new']) await promisify(execFile)('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', path.join(home, name)]);
    const key = async name => (await readFile(path.join(home, name + '.pub'), 'utf8')).split(' ').slice(0, 2).join(' ');
    oldKey = await key('old'); newKey = await key('new');
    fingerprint = 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(newKey.split(' ')[1], 'base64')).digest('base64').replace(/=+$/, '');
    original = `example.test ${oldKey}\nother.test ${oldKey}\n`;
    await writeFile(path.join(home, '.ssh/known_hosts'), original);
    await writeFile(path.join(home, 'bin/ssh-hold'), `#!/bin/sh
if [ "$1" = start ]; then
  cat >/dev/null
  printf 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nThe fingerprint is\n${fingerprint}.\n' >&2
  exit 1
fi
`, { mode: 0o700 });
    await writeFile(path.join(home, 'bin/ssh'), `#!/bin/sh
for arg in "$@"; do
 case "$arg" in UserKnownHostsFile=*) printf 'example.test ${newKey}\n' > "\${arg#UserKnownHostsFile=}";; esac
done
exit 1
`, { mode: 0o700 });
  });
  await f.setup();
  const result = await f.api('/api/channels', { name: 'test', target: 'root@example.test', port: 22, auth: 'password', password: 'fake-password' });
  assert.equal(result.response.status, 400);
  const challenge = result.data.hostKeyChallenge;
  assert.equal(challenge?.fingerprint, fingerprint, JSON.stringify(result.data));
  assert.equal(await readFile(path.join(f.home, '.ssh/known_hosts'), 'utf8'), original);
  assert.equal((await f.api('/api/host-keys/trust', { token: challenge.token })).response.status, 200);
  const updated = await readFile(path.join(f.home, '.ssh/known_hosts'), 'utf8');
  assert.ok(updated.includes(`other.test ${oldKey}`)); assert.ok(updated.includes(`example.test ${newKey}`));
  assert.ok(!updated.includes(`example.test ${oldKey}`));
  const backup = (await readdir(path.join(f.home, '.ssh'))).find(name => name.startsWith('known_hosts.deck-backup-'));
  assert.equal(await readFile(path.join(f.home, '.ssh', backup), 'utf8'), original);
  assert.equal((await f.api('/api/host-keys/trust', { token: challenge.token })).response.status, 400);
});
