// Bakes one prototype into the shipped icon.
//
//   node scripts/apply-icon.mjs 6
//
// Writes assets/cat.svg (the full tile, used for .icns/.png) and rewrites the
// two inline cats in src/renderer/index.html (sprite only, no tile — the app
// bar is already dark, so a tile behind it would just be a black rectangle).
// Generating both from prototypes/variants.mjs means the shipped mark can
// never drift from the one that was reviewed.

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

// 2. the in-app mark: same sprite, tile stripped so it sits on the dark bar
const inner = v.art.replace(/^<rect width="512" height="512"[^>]*\/>/, '');
const inline = (cls) =>
  `<svg class="${cls}" viewBox="0 0 512 512" shape-rendering="crispEdges" aria-hidden="true">` +
  inner +
  `</svg>`;

const htmlPath = path.join(root, 'src', 'renderer', 'index.html');
let html = await readFile(htmlPath, 'utf8');
html = html.replace(/<svg class="cat" viewBox="[^"]*"[\s\S]*?<\/svg>/, inline('cat'));
html = html.replace(/<svg class="cat big" viewBox="[^"]*"[\s\S]*?<\/svg>/, inline('cat big'));
await writeFile(htmlPath, html);
console.log('  rewrote both inline cats in src/renderer/index.html');
