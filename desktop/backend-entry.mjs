// The desktop owner holds stdin open. EOF also stops a WSL backend if its launcher exits.
process.env.SSH_HOLD_DESKTOP = '1';
process.env.HOST = '127.0.0.1';
const { shutdown } = await import('./src/server.js');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 4000); timeout.unref();
  await shutdown();
  process.exit(0);
}
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
