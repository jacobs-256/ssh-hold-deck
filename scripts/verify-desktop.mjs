import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const { checkDesktopResources } = await import('./check-desktop-resources.mjs');
const root=path.resolve(process.argv[2]||'desktop/backend');
await checkDesktopResources(root);
const manifest=JSON.parse(await readFile(path.join(root,'desktop-manifest.json'),'utf8'));
assert.equal(manifest.backend,'rust');
await assert.rejects(access(path.join(root,'runtime/node')));
const bundled=root.includes('.app/Contents/Resources/');
assert(bundled || manifest.platform === 'linux', 'Verify macOS using the built .app resource directory; Linux uses its packaged executable.');
const binary=bundled?path.resolve(root,'../../MacOS/ssh-hold-deck'):path.join(root,'ssh-hold-backend');
const home=await mkdtemp(path.join(os.tmpdir(),'deck-rust-check-'));
await mkdir(path.join(home,'hold'));
const token='rust-desktop-verification';
const child=spawn(binary,bundled?['--backend']:[],{cwd:root,env:{...process.env,HOME:home,PORT:'0',SSH_HOLD_DESKTOP:'1',SSH_HOLD_DESKTOP_TOKEN:token,SSH_HOLD_PUBLIC_DIR:path.join(root,'public'),SSH_HOLD_DIR:path.join(home,'hold'),SSH_HOLD_WEB_DATA_DIR:path.join(home,'data')},stdio:['pipe','pipe','inherit']});
const exited=once(child,'exit');const timeout=setTimeout(()=>child.kill('SIGKILL'),20000);
try{
  const ready=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',chunk=>{text+=chunk;const match=/^SSH_HOLD_DESKTOP_READY (.+)$/m.exec(text);if(match)resolve(JSON.parse(match[1]));});child.once('error',reject);child.once('exit',code=>reject(Error(`Rust backend exited before ready: ${code}`)));});
  assert.equal(ready.token,token);const base=`http://127.0.0.1:${ready.port}`;
  assert.equal((await (await fetch(base+'/api/auth/status')).json()).configured,false);
  for(const file of ['/','/dashboard.js','/assets/ssh-hold-deck-light.svg','/vendor/xterm.js','/vendor/xterm.css','/vendor/fit.js','/vendor/lucide.js','/vendor/marked.js','/vendor/purify.js']){const response=await fetch(base+file);assert.equal(response.status,200,file);assert((await response.arrayBuffer()).byteLength>0,file);}
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({password:'smoke-check-password',confirmPassword:'smoke-check-password'})});assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/channels',{headers:{cookie}})).status,200);
  child.stdin.end();const [code]=await exited;assert.equal(code,0);
  console.log('Rust desktop smoke check passed: no Node runtime, resources, SQLite, authentication, service and EOF shutdown.');
}finally{clearTimeout(timeout);if(child.exitCode===null){child.kill();await exited;}await rm(home,{recursive:true,force:true});}
