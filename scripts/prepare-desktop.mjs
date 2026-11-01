import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'desktop/backend');
if (!['darwin', 'linux'].includes(process.platform)) throw Error('Prepare the Windows WSL backend on a Linux runner, then download its artifact on Windows.');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'runtime'), { recursive: true });
for (const directory of ['src', 'public']) await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) await cp(path.join(root, file), path.join(output, file));
await cp(path.join(root, 'desktop/backend-entry.mjs'), path.join(output, 'backend-entry.mjs'));
await mkdir(path.join(output, 'scripts'));
await cp(path.join(root, 'scripts/setup-pty.js'), path.join(output, 'scripts/setup-pty.js'));
await cp(process.execPath, path.join(output, 'runtime/node'));
await chmod(path.join(output, 'runtime/node'), 0o755);
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output, stdio: 'inherit' });
execFileSync('npm', ['rebuild', 'node-pty'], { cwd: output, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(output, 'scripts/setup-pty.js')], { cwd: output, stdio: 'inherit' });
// Record the exact runtime used to install/build native dependencies.
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const runtime = await readFile(path.join(output, 'runtime/node'));
await writeFile(path.join(output, 'desktop-manifest.json'), JSON.stringify({
  version: pkg.version, platform: process.platform, arch: process.arch, node: process.version,
  runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
}, null, 2));
await cp(path.join(root, 'build/icons/default/icon.png'), path.join(root, 'desktop/loading/icon.png'));
console.log(`Desktop backend prepared: ${output}`);
