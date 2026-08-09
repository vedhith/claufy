// Rasterise assets/cat.svg into the sizes Electron and the packagers want, and
// on macOS assemble a real .icns. Kept out of the build: the icon changes about
// never, and iconutil only exists on macOS.

import sharp from 'sharp';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const svg = await readFile(path.join(assets, 'cat.svg'));

// density high enough that the 1024 render is not upscaled from a small raster
const render = (size) => sharp(svg, { density: 512 }).resize(size, size).png();

const flat = [16, 32, 64, 128, 256, 512, 1024];
for (const size of flat) {
  const file = size === 512 ? path.join(assets, 'icon.png') : path.join(assets, `icon-${size}.png`);
  await render(size).toFile(file);
}
console.log(`wrote ${flat.length} pngs (icon.png is 512)`);

if (process.platform !== 'darwin') {
  console.log('not macOS — skipping .icns');
  process.exit(0);
}

// iconutil insists on this exact naming, and on both the 1x and 2x of each size.
const iconset = path.join(assets, 'icon.iconset');
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

const pairs = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

for (const [size, name] of pairs) {
  await render(size).toFile(path.join(iconset, name));
}

await run('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
await rm(iconset, { recursive: true, force: true });
console.log('wrote assets/icon.icns');
