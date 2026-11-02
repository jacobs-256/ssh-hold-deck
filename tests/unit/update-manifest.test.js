import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createManifest } from '../../scripts/create-update-manifest.mjs';

test('update manifest requires complete, matching signed artifacts for all supported platforms', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deck-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const platforms = { 'macos-arm64': 'darwin-aarch64', 'macos-x64': 'darwin-x86_64', 'windows-x64': 'windows-x86_64' };
  for (const [label, platform] of Object.entries(platforms)) {
    const filename = `${label}.bin`;
    await writeFile(path.join(dir, filename), 'fixture');
    await writeFile(path.join(dir, filename + '.sig'), 'signature');
    await writeFile(path.join(dir, `update-${label}.json`), JSON.stringify({ version: '1.2.3', filename, platform, signature: 'signature' }));
  }
  const manifest = await createManifest(dir, 'owner/repo', 'v1.2.3', 'Release notes');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.notes, 'Release notes');
  assert.equal(Object.keys(manifest.platforms).length, 3);
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://github.com/owner/repo/releases/download/v1.2.3/macos-arm64.bin');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8')), manifest);
  await assert.rejects(createManifest(dir, 'owner/repo', 'v1.2.4'), /Invalid update metadata/);
  await writeFile(path.join(dir, 'windows-x64.bin.sig'), 'tampered');
  await assert.rejects(createManifest(dir, 'owner/repo', 'v1.2.3'), /Signature mismatch/);
  await writeFile(path.join(dir, 'windows-x64.bin.sig'), 'signature');
  await unlink(path.join(dir, 'macos-arm64.bin'));
  await assert.rejects(createManifest(dir, 'owner/repo', 'v1.2.3'), /ENOENT/);
  await assert.rejects(createManifest(dir, '', 'v1.2.3'), /Invalid release repository/);
});
