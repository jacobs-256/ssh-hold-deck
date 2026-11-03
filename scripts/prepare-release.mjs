import { readFile, writeFile } from 'node:fs/promises';
const version = process.argv[2]?.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) throw Error('Usage: npm run release:prepare -- 0.2.0');
for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
  const value = JSON.parse(await readFile(file, 'utf8')); value.version = version;
  if (value.packages?.['']) value.packages[''].version = version;
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
for (const file of ['src-tauri/Cargo.toml', 'backend-rust/Cargo.toml']) {
  const cargo = await readFile(file, 'utf8');
  await writeFile(file, cargo.replace(/^(version = ")[^"]+/m, `$1${version}`));
}
for (const file of ['backend-rust/Cargo.lock', 'src-tauri/Cargo.lock']) {
  const lock = await readFile(file, 'utf8');
  await writeFile(file, lock.replace(/(\[\[package\]\]\nname = "ssh-hold-(?:backend|deck)"\nversion = ")[^"]+/g, `$1${version}`));
}
for (const file of ['public/index.html', 'public/auth-ui.js']) {
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `v${version}`));
}
console.log(`Versions set to ${version}. Run RELEASE_TAG=v${version} node scripts/check-release-version.mjs, then commit and tag.`);
