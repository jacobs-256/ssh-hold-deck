import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rename, rm, stat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const exec = promisify(execFile);
const fingerprint = key => `SHA256:${crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64').replace(/=+$/, '')}`;

export function createHostKeyManager({ knownHosts = path.join(os.homedir(), '.ssh/known_hosts'), run = exec, now = Date.now } = {}) {
  const pending = new Map();
  let writing = false;
  async function challenge(error, config, proxy, session) {
    const offered = error.match(/fingerprint[^\n]*\n?\s*(SHA256:[A-Za-z0-9+/]+)/i)?.[1];
    if (!session || !error.includes('REMOTE HOST IDENTIFICATION HAS CHANGED') || !offered) return null;
    const host = config.target.slice(config.target.lastIndexOf('@') + 1);
    const port = Number(config.port || 22);
    const lookup = port === 22 ? host : `[${host}]:${port}`;
    const file = await realpath(knownHosts);
    const original = await readFile(file, 'utf8');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'deck-host-key-'));
    try {
      const captured = path.join(directory, 'known_hosts');
      // Capture the offered key without sending passwords or private-key authentication.
      await run('ssh', ['-F', '/dev/null', '-o', `UserKnownHostsFile=${captured}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=none', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', ...proxy, '-p', String(port), config.target, 'exit'], { timeout: 15000 }).catch(() => {});
      const lines = (await readFile(captured, 'utf8')).trim().split('\n');
      const key = lines.map(line => line.split(/\s+/)).find(parts => parts.length === 3 && fingerprint(parts[2]) === offered);
      if (!key) return null;
      const found = await run('ssh-keygen', ['-F', lookup, '-f', file]);
      const oldFingerprints = found.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/)).filter(parts => parts.length === 3).map(parts => fingerprint(parts[2]));
      if (!oldFingerprints.length) return null;
      for (const [token, item] of pending) if (item.expires < now()) pending.delete(token);
      if (pending.size >= 100) return null;
      const token = crypto.randomUUID();
      pending.set(token, { session, expires: now() + 120000, file, original, lookup, key: `${lookup} ${key[1]} ${key[2]}` });
      return { token, host: lookup, fingerprint: offered, oldFingerprints };
    } catch { return null; }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  async function trust(token, session) {
    const item = pending.get(token);
    if (!item || item.session !== session || item.expires < now()) throw new Error('指纹确认已过期，请重新连接');
    if (writing) throw new Error('正在更新主机指纹，请稍后重试');
    writing = true;
    const temporary = `${item.file}.deck-${crypto.randomUUID()}`;
    try {
      if (await readFile(item.file, 'utf8') !== item.original) throw new Error('主机指纹文件已变化，请重新连接后确认');
      const mode = (await stat(item.file)).mode & 0o777;
      await writeFile(temporary, item.original, { mode, flag: 'wx' });
      await run('ssh-keygen', ['-R', item.lookup, '-f', temporary]);
      const cleaned = await readFile(temporary, 'utf8');
      await writeFile(temporary, `${cleaned.trimEnd()}\n${item.key}\n`, { mode });
      await writeFile(`${item.file}.deck-backup-${crypto.randomUUID()}`, item.original, { mode: 0o600, flag: 'wx' });
      if (await readFile(item.file, 'utf8') !== item.original) throw new Error('主机指纹文件已变化，请重新连接后确认');
      await rename(temporary, item.file);
      pending.delete(token);
    } finally {
      writing = false;
      await rm(temporary, { force: true }); await rm(`${temporary}.old`, { force: true });
    }
  }
  return { challenge, trust };
}
