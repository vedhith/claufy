// Renders every variant into one PNG so the set can be eyeballed at once.
import sharp from 'sharp';
import { variants, svgFor } from './variants.mjs';
import { writeFile } from 'node:fs/promises';

const CELL = 190, PAD = 18, COLS = 4;
const rows = Math.ceil(variants.length / COLS);
const W = COLS * CELL + PAD * 2, H = rows * (CELL + 34) + PAD * 2;

const tiles = await Promise.all(
  variants.map((v) => sharp(Buffer.from(svgFor(v, 150))).png().toBuffer()),
);

const labels = variants
  .map((v, i) => {
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = PAD + c * CELL + CELL / 2;
    const y = PAD + r * (CELL + 34) + CELL + 22;
    return `<text x="${x}" y="${y}" font-family="monospace" font-size="17" fill="#ffffff" text-anchor="middle">${i + 1}</text>`;
  })
  .join('');

const bg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
     <rect width="${W}" height="${H}" fill="#2b2f39"/>${labels}</svg>`,
);

await sharp(bg)
  .composite(
    tiles.map((input, i) => ({
      input,
      left: PAD + (i % COLS) * CELL + (CELL - 150) / 2,
      top: PAD + Math.floor(i / COLS) * (CELL + 34),
    })),
  )
  .png()
  .toFile('prototypes/sheet.png');

console.log('wrote prototypes/sheet.png', W + 'x' + H);
