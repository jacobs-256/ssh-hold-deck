import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function checkDesktopResources(root = path.resolve('desktop/backend')) {
const pkg=JSON.parse(await readFile('package.json','utf8'));
const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'desktop-manifest.json'),'utf8'));
if(pkg.version!==manifest.version||pkg.version!==config.version||manifest.backend!=='rust')throw Error('Prepare Rust desktop resources before building.');
for(const file of ['public/index.html','public/vendor/xterm.js','public/vendor/xterm.css','public/vendor/lucide.js'])await access(path.join(root,file));
if(manifest.platform==='linux') await access(path.join(root,'ssh-hold-backend'));
console.log(`Verified Rust resources: ${manifest.platform}-${manifest.arch}`);
return manifest;
}
if(process.argv[1] === fileURLToPath(import.meta.url)) await checkDesktopResources(path.resolve(process.argv[2] || 'desktop/backend'));
