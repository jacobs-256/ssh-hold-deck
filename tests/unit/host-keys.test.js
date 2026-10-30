import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHostKeyManager } from '../../src/host-keys.js';

const exec = promisify(execFile);
test('host key replacement requires a matching observed fingerprint, session and unchanged file; backs up and preserves other hosts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-key-test-'));
  try {
    for (const name of ['old', 'new']) await exec('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', path.join(dir, name)]);
    const key = name => readFile(path.join(dir, `${name}.pub`), 'utf8').then(text => text.split(' ').slice(0, 2).join(' '));
    const oldKey = await key('old'), newKey = await key('new');
    const fingerprint = `SHA256:${crypto.createHash('sha256').update(Buffer.from(newKey.split(' ')[1], 'base64')).digest('base64').replace(/=+$/, '')}`;
    const file = path.join(dir, 'known_hosts');
    const original = `example.test ${oldKey}\nother.test ${oldKey}\n`;
    await writeFile(file, original, { mode: 0o600 });
    let now = 0, calls = 0;
    const manager = createHostKeyManager({ knownHosts: file, now: () => now, run: async (command, args, options) => {
      if (command !== 'ssh') return exec(command, args, options);
      calls++;
      assert.ok(args.includes('PreferredAuthentications=none'));
      assert.ok(args.includes('ProxyCommand=mock'));
      const capture = args.find(arg => arg.startsWith('UserKnownHostsFile=')).slice('UserKnownHostsFile='.length);
      await writeFile(capture, `example.test ${newKey}\n`);
      throw new Error('Expected unauthenticated probe');
    } });
    const error = `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nThe fingerprint for the ED25519 key sent by the remote host is\n${fingerprint}.`;
    const challenge = () => manager.challenge(error, { target: 'root@example.test', port: 22 }, ['-o', 'ProxyCommand=mock'], 'session');
    assert.equal(await manager.challenge('Authentication failed', {}, [], 'session'), null);
    const first = await challenge();
    assert.equal(first.fingerprint, fingerprint);
    assert.equal(first.oldFingerprints.length, 1);
    assert.equal(await readFile(file, 'utf8'), original, 'No change before confirmation');
    await assert.rejects(manager.trust(first.token, 'other-session'), /过期/);
    await manager.trust(first.token, 'session');
    const updated = await readFile(file, 'utf8');
    assert.ok(updated.includes(`other.test ${oldKey}`));
    assert.ok(updated.includes(`example.test ${newKey}`));
    assert.ok(!updated.includes(`example.test ${oldKey}`));
    const backup = (await readdir(dir)).find(name => name.startsWith('known_hosts.deck-backup-'));
    assert.equal(await readFile(path.join(dir, backup), 'utf8'), original);
    await assert.rejects(manager.trust(first.token, 'session'), /过期/);
    const second = await challenge(); now = 120001;
    await assert.rejects(manager.trust(second.token, 'session'), /过期/);
    const third = await challenge(); await writeFile(file, `${updated}# external change\n`);
    await assert.rejects(manager.trust(third.token, 'session'), /文件已变化/);
    const mismatched = await manager.challenge(error.replace(fingerprint, 'SHA256:wrong'), { target: 'root@example.test' }, ['-o', 'ProxyCommand=mock'], 'session');
    assert.equal(mismatched, null);
    assert.equal(calls, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
