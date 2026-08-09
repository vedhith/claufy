// Rasterise assets/cat.svg into the PNG sizes Electron and the packagers want.
// Kept as a script rather than a build step: the icon changes about never.

import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets', 'cat.svg');
const out = path.join(root, 'assets');
await mkdir(out, { recursive: true });

const svg = await readFile(src);
const sizes = [16, 32, 64, 128, 256, 512, 1024];

for (const size of sizes) {
  const file = size === 512 ? path.join(out, 'icon.png') : path.join(out, `icon-${size}.png`);
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(file);
  console.log('wrote', path.relative(root, file));
}
