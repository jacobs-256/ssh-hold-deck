import { readFile, access } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('desktop/backend/desktop-manifest.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
if (pkg.version !== manifest.version || pkg.version !== config.version) throw Error('Desktop versions differ. Run release:prepare and desktop:prepare.');
const expectedPlatform = process.platform === 'win32' ? 'linux' : process.platform;
if (manifest.platform !== expectedPlatform || manifest.arch !== process.arch) throw Error('Backend platform/architecture does not match this build.');
for (const file of ['runtime/node', 'backend-entry.mjs', 'src/server.js', 'public/index.html', 'node_modules/node-pty/package.json']) await access(`desktop/backend/${file}`);
console.log(`Verified resources: ${manifest.platform}-${manifest.arch}, Node ${manifest.node}`);
