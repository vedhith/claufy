// Bakes one prototype into the shipped icon.
//
//   node scripts/apply-icon.mjs 6
//
// Writes assets/cat.svg (used for .icns/.png) and rewrites the two inline cats
// in src/renderer/index.html. Generating both from prototypes/variants.mjs
// means the shipped mark can never drift from the one that was reviewed.
//
// The inline cats keep their tile. They used not to — the icon was a white cat
// on a black tile, and on the app's dark bar that tile was an invisible black
// rectangle, so stripping it was free. The shipped icon is now a black cat on a
// white tile, and stripping that leaves black ink on a dark bar: nothing at all.
// Keeping the tile also makes the in-app mark match the one in the Dock.

import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { variants, svgFor } from '../prototypes/variants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pick = Number(process.argv[2] ?? 6);

if (!Number.isInteger(pick) || pick < 1 || pick > variants.length) {
  console.error(`Pick 1..${variants.length}`);
  process.exit(1);
}

const v = variants[pick - 1];
console.log(`Applying #${pick} — ${v.name}`);

// 1. the app icon, tile and all
await writeFile(path.join(root, 'assets', 'cat.svg'), svgFor(v, 512) + '\n');
console.log('  wrote assets/cat.svg');

// 2. the in-app mark: the same artwork, tile and all
const inline = (cls) =>
  `<svg class="${cls}" viewBox="0 0 512 512" shape-rendering="crispEdges" aria-hidden="true">` +
  v.art +
  `</svg>`;

const htmlPath = path.join(root, 'src', 'renderer', 'index.html');
let html = await readFile(htmlPath, 'utf8');
html = html.replace(/<svg class="cat" viewBox="[^"]*"[\s\S]*?<\/svg>/, inline('cat'));
html = html.replace(/<svg class="cat big" viewBox="[^"]*"[\s\S]*?<\/svg>/, inline('cat big'));
await writeFile(htmlPath, html);
console.log('  rewrote both inline cats in src/renderer/index.html');
