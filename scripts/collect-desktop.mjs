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
