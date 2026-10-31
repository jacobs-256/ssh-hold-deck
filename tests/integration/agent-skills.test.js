import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

test('agent skill routes require authentication, same-origin mutations and explicit uninstall confirmation', { timeout: 15000 }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'deck-agent-api-'));
  await mkdir(path.join(home, '.claude'));
  const socket = net.createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'), DSH_HOME: path.join(home, '.dsh'),
      XDG_CONFIG_HOME: path.join(home, '.config'), PORT: String(port), HOST: '127.0.0.1',
      SSH_HOLD_DIR: path.join(home, 'hold'), SSH_HOLD_WEB_DATA_DIR: path.join(home, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const api = async (endpoint, method = 'GET', body, origin = base) => {
    const headers = { cookie, 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    const response = await fetch(base + endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  try {
    await once(child.stdout, 'data');
    const endpoint = '/api/system/agent-skills';
    assert.equal((await api(endpoint)).status, 401);
    assert.equal((await api(endpoint + '/claude', 'POST', {})).status, 401);
    assert.equal((await api('/api/auth/setup', 'POST', { password: 'agent-test-password', confirmPassword: 'agent-test-password' })).status, 200);
    assert.equal((await api(endpoint + '/claude', 'POST', {}, null)).status, 403);
    assert.equal((await api(endpoint + '/claude', 'POST', {}, 'https://evil.example')).status, 403);
    assert.equal((await api(endpoint + '/claude', 'POST', {})).status, 200);
    const installed = await (await api(endpoint)).json();
    assert.equal(installed.agents.find(agent => agent.id === 'claude').skillInstalled, true);
    assert.equal((await api(endpoint + '/claude', 'DELETE', {})).status, 400);
    await access(path.join(home, '.claude', 'skills', 'ssh-hold', 'SKILL.md'));
    assert.equal((await api(endpoint + '/claude', 'DELETE', { confirmed: true })).status, 200);
    await assert.rejects(access(path.join(home, '.claude', 'skills', 'ssh-hold')), { code: 'ENOENT' });
  } finally {
    child.kill(); await once(child, 'exit');
    await rm(home, { recursive: true, force: true });
  }
});
