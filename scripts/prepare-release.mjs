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
console.log(`Versions set to ${version}. Run cargo check to refresh Cargo.lock, then commit and tag v${version}.`);
