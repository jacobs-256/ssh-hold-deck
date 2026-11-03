import { readFile, access } from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const manifest=JSON.parse(await readFile('desktop/backend/desktop-manifest.json','utf8'));
if(pkg.version!==manifest.version||pkg.version!==config.version||manifest.backend!=='rust')throw Error('Prepare Rust desktop resources before building.');
for(const file of ['public/index.html','public/vendor/xterm.js','public/vendor/xterm.css','public/vendor/lucide.js'])await access(`desktop/backend/${file}`);
console.log(`Verified Rust resources: ${manifest.platform}-${manifest.arch}`);
