const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'icons');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function generate() {
  for (const [variant, source] of [
    ['default', 'ssh-hold-deck-icon.svg'],
    ['light', 'ssh-hold-deck-light.svg'],
    ['dark', 'ssh-hold-deck-dark.svg'],
  ]) {
    const directory = path.join(output, variant);
    await fs.mkdir(directory, { recursive: true });
    const svg = await fs.readFile(path.join(root, 'public', 'assets', source));
    await fs.writeFile(path.join(directory, 'icon.svg'), svg);
    for (const size of sizes) {
      await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(directory, `${size}x${size}.png`));
    }
    await fs.copyFile(path.join(directory, '1024x1024.png'), path.join(directory, 'icon.png'));

    // ICO directory entries point to embedded PNG frames (Windows Vista and later).
    const frames = await Promise.all(sizes.filter(size => size <= 256).map(async size => ({
      size, data: await fs.readFile(path.join(directory, `${size}x${size}.png`)),
    })));
    const header = Buffer.alloc(6 + frames.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(frames.length, 4);
    let offset = header.length;
    frames.forEach(({ size, data }, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(data.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += data.length;
    });
    await fs.writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, ...frames.map(frame => frame.data)]));

    const iconset = path.join(directory, 'icon.iconset');
    await fs.mkdir(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await fs.copyFile(path.join(directory, `${size * scale}x${size * scale}.png`),
          path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
      }
    }
    if (process.platform === 'darwin') {
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(directory, 'icon.icns')]);
    }
    console.log(`Generated ${variant}: ${directory}`);
  }
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
