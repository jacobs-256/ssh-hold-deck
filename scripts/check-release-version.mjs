import { readFile } from 'node:fs/promises';
const tag = process.env.RELEASE_TAG;
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (tag !== `v${pkg.version}` || config.version !== pkg.version || lock.packages[''].version !== pkg.version
  || /^version = "([^"]+)"/m.exec(cargo)?.[1] !== pkg.version) throw Error('Release tag and package/Cargo/Tauri versions must match.');
console.log(`Release version verified: ${tag}`);
