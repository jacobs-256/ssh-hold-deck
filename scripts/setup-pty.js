import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
if (process.platform === 'darwin') {
  const root = path.dirname(require.resolve('node-pty/package.json'));
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, 'build/Release/spawn-helper']) {
    const helper = path.join(root, relative);
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
