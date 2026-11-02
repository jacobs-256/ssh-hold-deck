import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const label = process.argv[2];
if (!['macos-arm64', 'macos-x64', 'windows-x64'].includes(label)) throw Error('Expected platform label');
const extension = label.startsWith('macos') ? '.dmg' : '.exe';
const source = path.resolve('src-tauri/target/release/bundle', label.startsWith('macos') ? 'dmg' : 'nsis');
async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(file));
    else if (entry.name.endsWith(extension)) output.push(file);
  }
  return output;
}
const installers = await files(source);
if (installers.length !== 1) throw Error(`Expected one ${extension} installer, found ${installers.length}`);
await mkdir('dist-desktop', { recursive: true });
const name = `SSH-Hold-Deck_${pkg.version}_${label}${label === 'windows-x64' ? '_setup' : ''}${extension}`;
await copyFile(installers[0], path.join('dist-desktop', name));
const sha = createHash('sha256').update(await readFile(installers[0])).digest('hex');
await writeFile(path.join('dist-desktop', name + '.sha256'), `${sha}  ${name}\n`);
console.log(name);
if (!process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()) {
  console.log('Standalone installer collected; online updater is disabled.');
  process.exit(0);
}

const updateSource = label.startsWith('macos') ? path.resolve('src-tauri/target/release/bundle/macos') : source;
const updateExtension = label.startsWith('macos') ? '.app.tar.gz' : '.exe';
async function findUpdate(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await findUpdate(file));
    else if (entry.name.endsWith(updateExtension + '.sig')) found.push(file.slice(0, -4));
  }
  return found;
}
const updates = await findUpdate(updateSource);
if (updates.length !== 1) throw Error(`Expected one signed updater for ${label}, found ${updates.length}`);
const updateName = label.startsWith('macos') ? `SSH-Hold-Deck_${pkg.version}_${label}.app.tar.gz` : name;
await copyFile(updates[0], path.join('dist-desktop', updateName));
await copyFile(updates[0] + '.sig', path.join('dist-desktop', updateName + '.sig'));
if (label.startsWith('macos')) {
  const hash = createHash('sha256').update(await readFile(updates[0])).digest('hex');
  await writeFile(path.join('dist-desktop', updateName + '.sha256'), `${hash}  ${updateName}\n`);
}
const platform = { 'macos-arm64': 'darwin-aarch64', 'macos-x64': 'darwin-x86_64', 'windows-x64': 'windows-x86_64' }[label];
await writeFile(path.join('dist-desktop', `update-${label}.json`), JSON.stringify({
  version: pkg.version, platform, filename: updateName,
  signature: (await readFile(updates[0] + '.sig', 'utf8')).trim(),
}, null, 2));
