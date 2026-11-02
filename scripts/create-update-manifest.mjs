import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createManifest(directory, repository, tag, notes = '') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw Error('Invalid release repository');
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag || '')) throw Error('Invalid release tag');
  const platforms = {};
  for (const label of ['macos-arm64', 'macos-x64', 'windows-x64']) {
    const item = JSON.parse(await readFile(path.join(directory, `update-${label}.json`), 'utf8'));
    const expected = { 'macos-arm64': 'darwin-aarch64', 'macos-x64': 'darwin-x86_64', 'windows-x64': 'windows-x86_64' }[label];
    if (item.version !== tag.slice(1) || item.platform !== expected || !item.signature?.trim() || path.basename(item.filename) !== item.filename) throw Error(`Invalid update metadata: ${label}`);
    const signature = (await readFile(path.join(directory, item.filename + '.sig'), 'utf8')).trim();
    if (signature !== item.signature) throw Error(`Signature mismatch: ${label}`);
    await readFile(path.join(directory, item.filename));
    platforms[item.platform] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(item.filename)}`,
    };
  }
  const manifest = { version: tag.slice(1), notes, pub_date: new Date().toISOString(), platforms };
  await writeFile(path.join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, repository, tag, notesFile] = process.argv.slice(2);
  await createManifest(directory, repository, tag, notesFile ? await readFile(notesFile, 'utf8') : '');
}
