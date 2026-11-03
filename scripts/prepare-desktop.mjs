import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareWeb } from './prepare-web.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'desktop/backend');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
await prepareWeb(path.join(output,'public'));
execFileSync('cargo',['build','--release','--manifest-path',path.join(root,'backend-rust/Cargo.toml')],{stdio:'inherit'});
// Windows retains its WSL SSH environment, now using a Linux Rust executable.
if(process.platform==='linux') {
  await cp(path.join(root,'backend-rust/target/release/ssh-hold-backend'),path.join(output,'ssh-hold-backend'));
  await chmod(path.join(output,'ssh-hold-backend'),0o755);
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(output,'desktop-manifest.json'),JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,backend:'rust'},null,2));
await cp(path.join(root,'build/icons/default/icon.png'),path.join(root,'desktop/loading/icon.png'));
console.log(`Rust desktop resources prepared: ${output}`);
