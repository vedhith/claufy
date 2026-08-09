// Round two of the icon prototypes. The first set was reviewed in a toolbar and
// came back "too big and not uniform" — both of which have the same cause.
//
// TOO BIG: the sprite was 16 cells wide on an 18-cell tile, so the cat covered
// 89% of the icon and ran almost to the rounded corners. Round two keeps the
// tile at a fixed 16 cells and shrinks the *cat*, so zoom is one number.
//
// NOT UNIFORM: 18 cells across a 16px icon is 0.888px per cell. No cell edge
// lands on a pixel boundary, so the renderer rounds each one differently and
// the "pixels" come out different widths — which is exactly what an uneven
// pixel icon looks like. A 16-cell tile is 1.00px per cell at 16px, 2.00 at 32,
// 4.00 at 64, 8.00 at 128. Every mark below is exact at all four.
//
// Same rules as round one: flat fill, one ink colour, no strokes, no gradients.
//   '#' = ink   'o' = knocked back out to the tile   '.' = empty

export const TILE = '#ffffff';
export const INK = '#000000';

// The whole point: 16 divides every icon size that matters.
export const GRID = 16;

// --- the sprites --------------------------------------------------------
// Width sets the zoom. 14 is tight, 6 is tiny, and the tile is always 16.

// 14 wide — closest to the icon that shipped, with a cell of air added.
const s14 = [
  '##..........##',
  '###........###',
  '##############',
  '##############',
  '##############',
  '###oo####oo###',
  '###oo####oo###',
  '##############',
  '######oo######',
  '##############',
  '.############.',
  '..##########..',
  '...########...',
];

// 12 wide — the same face with a cell taken off every feature.
const s12 = [
  '##........##',
  '##........##',
  '############',
  '############',
  '##oo####oo##',
  '##oo####oo##',
  '############',
  '#####oo#####',
  '############',
  '.##########.',
  '..########..',
];

// 12 wide, single-cell eyes and no nose. The least face that is still a face.
const s12dot = [
  '##........##',
  '##........##',
  '############',
  '############',
  '###o####o###',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
];

// 12 wide, square ears and a flat jaw. Nothing tapers, so nothing wobbles.
const s12square = [
  '##........##',
  '##........##',
  '############',
  '############',
  '##oo####oo##',
  '##oo####oo##',
  '############',
  '############',
  '############',
  '############',
  '############',
];

// 12 x 8 — squat. Reads wide in a row of square icons.
const s12wide = [
  '#..........#',
  '##........##',
  '############',
  '############',
  '##oo####oo##',
  '############',
  '.##########.',
  '..########..',
];

const s10 = [
  '#........#',
  '##......##',
  '##########',
  '##########',
  '##o####o##',
  '##########',
  '##########',
  '.########.',
  '..######..',
];

// No face at all — shape only, the most Claude-like option in the set.
const s10solid = [
  '#........#',
  '##......##',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '.########.',
  '..######..',
];

// Taller ears, narrower head.
const s10tall = [
  '#........#',
  '#........#',
  '##......##',
  '##########',
  '##########',
  '##o####o##',
  '##########',
  '##########',
  '##########',
  '.########.',
  '..######..',
];

// Hollow: ink on the edge, tile showing through, eyes as ink dots. Lightest.
const s10hollow = [
  '#........#',
  '##......##',
  '##########',
  '#oooooooo#',
  '#o#oooo#o#',
  '#oooooooo#',
  '#oooooooo#',
  '.#oooooo#.',
  '..######..',
];

// Corners knocked off the head block, so the silhouette is softer.
const s10round = [
  '#........#',
  '##......##',
  '.########.',
  '##########',
  '##o####o##',
  '##########',
  '.########.',
  '..######..',
];

const s8 = [
  '#......#',
  '########',
  '########',
  '#o####o#',
  '########',
  '.######.',
  '..####..',
];

// 6 wide — one cell is 2px at 16px. Loudest thing here.
const s6 = [
  '#....#',
  '######',
  '#o##o#',
  '######',
  '.####.',
];

// --- rendering ----------------------------------------------------------

// Centred on the 16-cell tile, offsets snapped to whole cells so every edge
// stays on a pixel boundary. Rounding here rather than allowing a half-cell
// offset is the difference between crisp and the mush that got rejected.
function sprite(rows, ink, tile) {
  const cols = rows[0].length;
  const cell = 512 / GRID;
  const offX = Math.round((GRID - cols) / 2);
  const offY = Math.round((GRID - rows.length) / 2);
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = rows[y][x];
      if (ch !== '#' && ch !== 'o') continue;
      // +0.5 overdraw closes the hairline seams antialiasing leaves between
      // neighbouring rects at fractional scales.
      out.push(
        `<rect x="${((x + offX) * cell).toFixed(2)}" y="${((y + offY) * cell).toFixed(2)}" ` +
          `width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}" ` +
          `fill="${ch === '#' ? ink : tile}"/>`,
      );
    }
  }
  return out.join('');
}

const tileOf = (bg) => `<rect width="512" height="512" rx="112" fill="${bg}"/>`;
const make = (rows, { ink = INK, bg = TILE } = {}) => tileOf(bg) + sprite(rows, ink, bg);

// Percentage of the tile the cat covers — the "too big" number, made visible.
const cover = (rows) => Math.round((rows[0].length / GRID) * 100);

export const variantsB = [
  { name: 'Fourteen', rows: s14, note: 'Closest to the icon that shipped, with a cell of air added all round.' },
  { name: 'Twelve', rows: s12, note: 'The same face, one cell off every feature. The safe pick.' },
  { name: 'Twelve, dot eyes', rows: s12dot, note: 'Single-cell eyes, no nose. The least face that is still a face.' },
  { name: 'Twelve, square', rows: s12square, note: 'Square ears, flat jaw. Nothing tapers, so nothing wobbles small.' },
  { name: 'Twelve, wide', rows: s12wide, note: 'Squat. Reads wide in a row of square icons.' },
  { name: 'Ten', rows: s10, note: 'Half the tile is air. This is what "zoomed out" looks like.' },
  { name: 'Ten, solid', rows: s10solid, note: 'No face at all — shape only. The most Claude-like of the set.' },
  { name: 'Ten, tall ears', rows: s10tall, note: 'Longer ears, narrower head. More cat, less bear.' },
  { name: 'Ten, hollow', rows: s10hollow, note: 'Ink on the edge, tile showing through. Lightest weight here.' },
  { name: 'Ten, rounded', rows: s10round, note: 'Corners knocked off the head, so the silhouette softens.' },
  { name: 'Eight', rows: s8, note: 'Two pixels per cell at 16px. Very few cells, very hard to blur.' },
  { name: 'Six', rows: s6, note: 'The loudest thing here. Almost a logo mark rather than a cat.' },
].map((v) => ({ ...v, art: make(v.rows), cover: cover(v.rows) }));

export { make, sprite, cover };
