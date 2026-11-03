import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareWeb(output = path.join(root, 'desktop/backend/public')) {
  await mkdir(output, { recursive: true });
  await cp(path.join(root, 'public'), output, { recursive: true });
  await mkdir(path.join(output, 'vendor'), { recursive: true });
  for (const [source, destination] of Object.entries({
    '@xterm/xterm/lib/xterm.js': 'xterm.js', '@xterm/xterm/css/xterm.css': 'xterm.css',
    '@xterm/addon-fit/lib/addon-fit.js': 'fit.js', 'lucide/dist/umd/lucide.js': 'lucide.js',
    'marked/lib/marked.umd.js': 'marked.js', 'dompurify/dist/purify.min.js': 'purify.js',
  })) await cp(path.join(root, 'node_modules', source), path.join(output, 'vendor', destination));
  for (const pkg of ['@xterm/xterm', '@xterm/addon-fit', 'lucide', 'marked', 'dompurify']) {
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
      try { await cp(path.join(root, 'node_modules', pkg, name), path.join(output, 'vendor', pkg.replaceAll('/', '-') + '-' + name)); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareWeb();
