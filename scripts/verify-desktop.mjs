import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

await import('./check-desktop-resources.mjs');
const root = path.resolve(process.argv[2] || 'desktop/backend');
const manifest = JSON.parse(await readFile(path.join(root, 'desktop-manifest.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(path.join(root, 'runtime/node'))).digest('hex'), manifest.runtimeSha256);
const runtime = path.join(root, 'runtime/node');
execFileSync(runtime, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import { DatabaseSync } from 'node:sqlite';
  import * as pty from 'node-pty';
  const db=new DatabaseSync(':memory:');assert.equal(db.prepare('SELECT 1 AS n').get().n,1);db.close();
  const shell=pty.spawn('/bin/sh',['-c','printf DESKTOP_PTY_OK'],{cols:80,rows:24,env:process.env});
  let output='';shell.onData(data=>output+=data);
  const timeout=setTimeout(()=>process.exit(1),5000);
  shell.onExit(()=>{clearTimeout(timeout);assert(output.includes('DESKTOP_PTY_OK'));});
`], { cwd: root, stdio: 'inherit' });
const home = await mkdtemp(path.join(os.tmpdir(), 'deck-desktop-check-'));
await mkdir(path.join(home, 'hold'));
const token = 'desktop-verification-instance';
const child = spawn(runtime, [path.join(root, 'backend-entry.mjs')], {
  cwd: root, env: { ...process.env, HOME: home, SSH_HOLD_WINDOWS_HOME: '', SSH_HOLD_DIR: path.join(home, 'hold'),
    HOST: '0.0.0.0', PORT: '0', SSH_HOLD_DESKTOP_TOKEN: token, SSH_HOLD_WEB_DATA_DIR: path.join(home, 'data') },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const exited = once(child, 'exit');
const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
try {
  const ready = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk;
      const match = /^SSH_HOLD_DESKTOP_READY (.+)$/m.exec(text);
      if (match) resolve(JSON.parse(match[1]));
    });
    child.once('exit', code => reject(Error(`Backend exited before ready: ${code}`)));
    child.once('error', reject);
  });
  assert.equal(ready.token, token);
  const base = `http://127.0.0.1:${ready.port}`;
  const response = await fetch(base + '/api/auth/status');
  assert.equal(response.status, 200); assert.equal((await response.json()).configured, false);
  for (const file of ['/', '/assets/ssh-hold-deck-light.svg', '/dashboard.js', '/vendor/marked.js']) assert.equal((await fetch(base + file)).status, 200);
  child.stdin.end();
  const [code] = await exited; assert.equal(code, 0);
  console.log('Desktop smoke check passed: runtime hash, SQLite, PTY, service, resources and EOF shutdown.');
} finally {
  clearTimeout(timeout); if (child.exitCode === null) { child.kill(); await exited; }
  await rm(home, { recursive: true, force: true });
}
