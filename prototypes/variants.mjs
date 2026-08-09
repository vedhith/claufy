// Single source of truth for the icon prototypes: the page and the contact
// sheet both import this, so what gets reviewed is what gets shipped.
//
// Pixel art, drawn on a real grid. Each sprite is a list of rows where
//   '#' = ink, 'o' = knocked back out to the tile colour, '.' = empty.
// Rendered as one <rect> per cell with shape-rendering="crispEdges", so the
// steps stay hard at every size instead of being smoothed into mush.
//
// Flat fills only — no outlines, no gradients, one ink colour per icon. That
// is what makes a mark read instantly at 16px.

export const TILE_LIGHT = '#ffffff';
export const INK = '#000000';

// 16x16: enough grid to shape an ear, few enough cells to stay a pixel icon.
const cat16 = [
  '................',
  '.##..........##.',
  '.###........###.',
  '.####......####.',
  '.##############.',
  '################',
  '################',
  '###oo######oo###',
  '###oo######oo###',
  '################',
  '#######oo#######',
  '.##############.',
  '.##############.',
  '..############..',
  '....########....',
  '................',
];

// 12x12: fewer, fatter pixels. Chunkier and louder in a Dock.
const cat12 = [
  '............',
  '.#........#.',
  '.##......##.',
  '.##########.',
  '############',
  '##oo####oo##',
  '##oo####oo##',
  '############',
  '#####oo#####',
  '############',
  '.##########.',
  '...######...',
];

// No face at all. Pure silhouette, the most Claude-like of the set.
const catSolid = [
  '................',
  '.#............#.',
  '.##..........##.',
  '.###........###.',
  '.####......####.',
  '.#####....#####.',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '....########....',
  '................',
];

// Hollow: ink only on the edge, so the tile shows through the middle.
const catOutline = [
  '................',
  '.##..........##.',
  '.#.#........#.#.',
  '.#..#......#..#.',
  '.#...######...#.',
  '#..............#',
  '#..............#',
  '#...##....##...#',
  '#...##....##...#',
  '#..............#',
  '#......##......#',
  '.#............#.',
  '.#............#.',
  '..#..........#..',
  '....########....',
  '................',
];

// Eyes as single cells and a wider jaw — reads younger, less blocky.
const catSlim = [
  '................',
  '..#..........#..',
  '..##........##..',
  '..###......###..',
  '..############..',
  '.##############.',
  '.##############.',
  '.###o######o###.',
  '.##############.',
  '.##############.',
  '.#####oo######..',
  '.##############.',
  '..############..',
  '...##########...',
  '.....######.....',
  '................',
];

// --- side profiles ------------------------------------------------------
// A head is only one way to draw a cat, and at icon size a body silhouette
// carries further: the tail gives it an asymmetric outline, which is what
// makes a shape recognisable in a Dock full of squares.

// Sitting, facing right, tail up behind.
const catSit = [
  '................',
  '.........##..##.',
  '.........######.',
  '.........#####..',
  '.........#####..',
  '........######..',
  '.......#######..',
  '......########..',
  '.....#########..',
  '.....##########.',
  '.##..##########.',
  '.#...##########.',
  '.#...#########..',
  '.#...#########..',
  '.#############..',
  '................',
];

// Walking, facing left, tail raised.
const catWalk = [
  '................',
  '................',
  '................',
  '.##..........#..',
  '.####.......##..',
  '.#####.....###..',
  '..###########...',
  '..############..',
  '..############..',
  '..############..',
  '..##.##...##.##.',
  '..##.##...##.##.',
  '................',
  '................',
  '................',
  '................',
];

// Loaf: paws tucked, the shape a cat makes when it has no intention of moving.
const catLoaf = [
  '................',
  '................',
  '................',
  '..##........##..',
  '..###......###..',
  '..############..',
  '.##############.',
  '################',
  '###o########o###',
  '################',
  '################',
  '.##############.',
  '..############..',
  '................',
  '................',
  '................',
];

function sprite(rows, ink, tile) {
  const n = rows.length;
  const cols = rows[0].length;
  // One padding cell all round so the ears never touch the tile edge.
  const cell = 512 / (cols + 2);
  const out = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = rows[y][x];
      if (ch !== '#' && ch !== 'o') continue;
      const px = (x + 1) * cell;
      const py = (y + 1) * cell;
      // +0.5 overdraw closes the hairline seams antialiasing leaves between
      // neighbouring rects at non-integer scales.
      out.push(
        `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(cell + 0.5).toFixed(2)}" ` +
          `height="${(cell + 0.5).toFixed(2)}" fill="${ch === '#' ? ink : tile}"/>`,
      );
    }
  }
  return out.join('');
}

const tileOf = (bg) => `<rect width="512" height="512" rx="112" fill="${bg}"/>`;

const make = (rows, { ink = INK, bg = TILE_LIGHT } = {}) => tileOf(bg) + sprite(rows, ink, bg);

export const variants = [
  {
    name: 'Pixel cat',
    note: '16x16, solid, eyes and nose knocked out. The straight answer.',
    art: make(cat16),
  },
  {
    name: 'Chunky pixel cat',
    note: '12x12 — fewer, fatter pixels. Loudest of the set at small sizes.',
    art: make(cat12),
  },
  {
    name: 'Silhouette',
    note: 'No face at all. Shape only, the most Claude-like thing here.',
    art: make(catSolid),
  },
  {
    name: 'Outline',
    note: 'Hollow: ink on the edge, tile showing through. Lightest.',
    art: make(catOutline),
  },
  {
    name: 'Slim',
    note: 'Single-cell eyes, wider jaw, tapered chin.',
    art: make(catSlim),
  },
  {
    name: 'Pixel cat, inverted',
    note: 'Black tile, white cat. Same sprite, opposite ink.',
    art: make(cat16, { ink: '#ffffff', bg: '#000000' }),
  },
  {
    name: 'Claude clay',
    note: "Anthropic's clay on off-white — same sprite, their palette.",
    art: make(cat16, { ink: '#d97757', bg: '#faf9f5' }),
  },
  {
    name: 'Sitting, side profile',
    note: 'Whole cat, tail up. The tail is what makes it readable in a Dock.',
    art: make(catSit),
  },
  {
    name: 'Sitting, clay',
    note: 'Same body in the Claude palette.',
    art: make(catSit, { ink: '#d97757', bg: '#faf9f5' }),
  },
  {
    name: 'Walking, side profile',
    note: 'Full body, four legs, tail raised. The widest mark of the set.',
    art: make(catWalk),
  },
  {
    name: 'Loaf',
    note: 'Paws tucked, one eye. Compact and very square-friendly.',
    art: make(catLoaf),
  },
  {
    name: 'Silhouette on clay',
    note: 'Faceless shape in clay. The simplest mark of the eight.',
    art: make(catSolid, { ink: '#d97757', bg: '#faf9f5' }),
  },
];

export const svgFor = (v, px = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512" ` +
  `shape-rendering="crispEdges">${v.art}</svg>`;

// Kept for the page, which renders without the xmlns wrapper.
export const TILE = '';
