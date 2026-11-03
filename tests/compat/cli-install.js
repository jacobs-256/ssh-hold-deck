import { access, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execute = promisify(execFile);
const installDir = path.join(os.homedir(), '.local', 'bin');
// Finder launches and freshly installed CLIs need these paths without a shell restart.
process.env.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), installDir, '/opt/homebrew/bin', '/usr/local/bin'])].join(path.delimiter);
let installing;
export async function cliStatus() {
  let executable;
  for (const dir of process.env.PATH.split(path.delimiter)) {
    const candidate = path.join(dir, 'ssh-hold');
    try { await access(candidate, constants.X_OK); executable = candidate; break; } catch {}
  }
  if (!executable) return { installed:false, supported:process.platform !== 'win32', installing:Boolean(installing) };
  try {
    const {stdout} = await execute(executable, ['version'], {timeout:5000,maxBuffer:16384});
    return {installed:true, path:executable, version:stdout.trim(), installing:false};
  } catch {
    return {installed:true, path:executable, version:null, installing:false};
  }
}
export async function installCli() {
  if (installing) return installing;
  installing = (async () => {
    const current = await cliStatus();
    if (current.installed) return current;
    if (!current.supported) throw new Error('当前系统不支持自动安装 ssh-hold');
    const response = await fetch('https://github.com/CherryLover/ssh-hold/releases/latest/download/ssh-hold', {signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('安装文件过大');
    const content = Buffer.from(bytes);
    if (!content.subarray(0,128).toString().startsWith('#!')) throw new Error('下载的安装文件格式无效');
    await mkdir(installDir, {recursive:true,mode:0o700});
    const temporary = path.join(installDir, `.ssh-hold-${crypto.randomUUID()}`);
    try {
      await writeFile(temporary,content,{mode:0o755,flag:'wx'});
      await execute('/bin/bash',['-n',temporary],{timeout:5000});
      await rename(temporary,path.join(installDir,'ssh-hold'));
    } finally { await rm(temporary,{force:true}); }
    return cliStatus();
  })();
  try { return await installing; } finally { installing = undefined; }
}
