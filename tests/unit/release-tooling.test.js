import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '../..');
test('release preparation updates every version and checking catches stale locks and UI', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deck-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'backend-rust/Cargo.toml',
    'backend-rust/Cargo.lock', 'public/index.html', 'public/auth-ui.js'];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(project, file), path.join(root, file));
  }
  const run = (script, args = []) => execFileSync(process.execPath, [path.join(project, 'scripts', script), ...args],
    { cwd: root, env: { ...process.env, RELEASE_TAG: 'v2.3.4' }, stdio: 'pipe' });
  run('prepare-release.mjs', ['2.3.4']);
  run('check-release-version.mjs');
  for (const file of ['src-tauri/Cargo.lock', 'public/auth-ui.js']) {
    const target = path.join(root, file);
    const original = await readFile(target, 'utf8');
    await writeFile(target, original.replaceAll('2.3.4', '2.3.3'));
    assert.throws(() => run('check-release-version.mjs'));
    await writeFile(target, original);
  }
});

test('desktop resource check reads the supplied bundle and requires its Linux executable', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deck-resources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const version = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version;
  for (const file of ['public/index.html', 'public/vendor/xterm.js', 'public/vendor/xterm.css', 'public/vendor/lucide.js']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'fixture');
  }
  await writeFile(path.join(root, 'desktop-manifest.json'), JSON.stringify({ version, backend: 'rust', platform: 'linux', arch: 'x64' }));
  const run = () => execFileSync(process.execPath, [path.join(project, 'scripts/check-desktop-resources.mjs'), root], { cwd: project, stdio: 'pipe' });
  assert.throws(run);
  await writeFile(path.join(root, 'ssh-hold-backend'), 'fixture');
  run();
  await rm(path.join(root, 'public/index.html'));
  assert.throws(run);
});
