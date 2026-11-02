import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export async function pruneDesktop(root) {
  const modules = path.join(root, 'node_modules');
  const remove = relative => rm(path.join(modules, relative), { recursive: true, force: true });
  await remove('.bin');
  const vendor = {
    lucide: ['dist/umd/lucide.js'],
    '@xterm/xterm': ['lib/xterm.js', 'css/xterm.css'],
    '@xterm/addon-fit': ['lib/addon-fit.js'],
    marked: ['lib/marked.umd.js'],
    dompurify: ['dist/purify.min.js'],
  };
  // These packages are served as static files, never imported by the backend.
  for (const [name, files] of Object.entries(vendor)) {
    const keep = [...files, 'package.json'];
    async function walk(relative = '') {
      for (const entry of await readdir(path.join(modules, name, relative), { withFileTypes: true })) {
        const file = path.posix.join(relative, entry.name);
        if (/^(license|licence|copying|notice)/i.test(entry.name)) continue;
        if (keep.includes(file)) continue;
        if (entry.isDirectory() && keep.some(item => item.startsWith(`${file}/`))) await walk(file);
        else await remove(path.posix.join(name, file));
      }
    }
    await walk();
  }
  for (const entry of await readdir(path.join(modules, 'node-pty/prebuilds'))) {
    if (entry !== `${process.platform}-${process.arch}`) await remove(`node-pty/prebuilds/${entry}`);
  }
  for (const directory of ['src', 'deps', 'third_party', 'typings', 'scripts']) await remove(`node-pty/${directory}`);
  await remove('node-pty/binding.gyp');
  // Runtime JavaScript remains intact; source maps and tests are development assets.
  async function clean(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (['test', 'tests', '__tests__'].includes(entry.name)) await rm(file, { recursive: true });
        else await clean(file);
      } else if (entry.name.endsWith('.map')) await rm(file);
    }
  }
  await clean(modules);
}
