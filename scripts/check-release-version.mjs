import { readFile } from 'node:fs/promises';
const tag = process.env.RELEASE_TAG;
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
const backend = await readFile('backend-rust/Cargo.toml', 'utf8');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (tag !== `v${pkg.version}` || config.version !== pkg.version || lock.packages[''].version !== pkg.version
  || /^version = "([^"]+)"/m.exec(cargo)?.[1] !== pkg.version
  || /^version = "([^"]+)"/m.exec(backend)?.[1] !== pkg.version) throw Error('Release tag and package/Cargo/Tauri versions must match.');
for (const file of ['backend-rust/Cargo.lock', 'src-tauri/Cargo.lock']) {
  const source = await readFile(file, 'utf8');
  const versions = [...source.matchAll(/\[\[package\]\]\nname = "ssh-hold-(?:backend|deck)"\nversion = "([^"]+)"/g)];
  const expected = file.startsWith('src-tauri') ? 2 : 1;
  if (versions.length !== expected || versions.some(match => match[1] !== pkg.version)) throw Error(`Version mismatch: ${file}`);
}
for (const file of ['public/index.html', 'public/auth-ui.js']) {
  const source = await readFile(file, 'utf8');
  const versions = source.match(/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g) || [];
  if (!versions.length || versions.some(version => version !== tag)) throw Error(`Displayed version mismatch: ${file}`);
}
console.log(`Release version verified: ${tag}`);
