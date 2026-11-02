import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const publicKey = (process.env.TAURI_UPDATER_PUBLIC_KEY || '').trim();
if (publicKey && !process.env.TAURI_SIGNING_PRIVATE_KEY) throw Error('A signed updater build requires TAURI_SIGNING_PRIVATE_KEY');
const directory = await mkdtemp(path.join(tmpdir(), 'deck-build-'));
try {
  const config = path.join(directory, 'updater.json');
  // The CLI needs the same public key as Rust to verify the signing key pair.
  await writeFile(config, JSON.stringify({
    bundle: { createUpdaterArtifacts: Boolean(publicKey) },
    plugins: { updater: { pubkey: publicKey } },
  }));
  const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
  const child = spawn(process.execPath, [cli, 'build', '--config', config, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
