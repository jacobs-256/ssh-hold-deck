import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const binary = path.resolve(process.env.SSH_HOLD_TEST_BINARY || 'backend-rust/target/debug/ssh-hold-backend');
export async function fixture(t, prepare = async () => {}, environment = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'deck-rust-api-'));
  await mkdir(path.join(home, 'bin'));
  await prepare(home);
  let child;
  t.after(async () => {
    if (child?.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(home, { recursive: true, force: true });
  });
  let base, cookie = '';
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST', options = {}) => {
    const response = await fetch(base + route, {
      method, headers: { cookie, origin: base, 'content-type': 'application/json', ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, data: await response.json() };
  };
  const start = async () => {
    child = spawn(binary, [], {
      env: { ...process.env, HOME: home, PORT: '0', HOST: '127.0.0.1', SSH_HOLD_DESKTOP: '0',
        SSH_HOLD_WEB_DATA_DIR: path.join(home, 'data'), SSH_HOLD_DIR: path.join(home, 'hold'),
        CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
        XDG_CONFIG_HOME: path.join(home, '.config'), DSH_HOME: path.join(home, '.dsh'),
        PATH: `${home}/bin:${process.env.PATH}`, ...environment }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    base = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(Error('Rust startup timed out: ' + output)), 15000);
      child.stdout.on('data', chunk => { output += chunk; const match = /http:\/\/localhost:\d+/.exec(output); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(Error('Rust exited: ' + code + ': ' + output)); });
    });
  };
  await start();
  return { home, api, get base() { return base; }, get cookie() { return cookie; },
    set base(value) { base = value; },
    async restart() { child.kill(); await once(child, 'exit'); await start(); },
    async setup(password = 'test-password') { return api('/api/auth/setup', { password, confirmPassword: password }); },
  };
}
