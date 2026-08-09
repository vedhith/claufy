// Round three. Round two was solid silhouettes and got rejected: "these are
// kind of really bad, they should not be filled in. Do an outline of black,
// then an empty inside, and then the eye and mouth are also black."
//
// So every mark here is LINE ART: a one-cell black outline, the tile showing
// straight through the middle, and the eye and mouth drawn in the same black.
// Nothing is filled. Side views included, because the whole set being one
// front-facing head is what made round two samey.
//
// The 16-cell tile from round two stays, and matters more now than it did.
// A one-cell outline is one device pixel at 16px — but only if the cell grid
// lands on pixel boundaries. 16 cells does (1.00px per cell at 16px, 2.00 at
// 32, 4.00 at 64). The old 18-cell tile gave 0.888px per cell, which is what
// made the first icon look uneven, and a thin outline would show that far
// worse than a solid shape did.
//
//   '#' = ink (outline, eye, mouth)   '.' = empty, tile shows through
// There is no fill character on purpose. Nothing in this file is solid.

export const TILE = '#ffffff';
export const INK = '#000000';
export const GRID = 16;

// Side views come in pairs for free, and a mirrored sprite cannot be drawn
// wrong in a way the original was not.
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

// --- front views --------------------------------------------------------

// The straight answer: pointed ears, two eyes, a small mouth.
const front = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#.#......#.#',
  '#..........#',
  '#....##....#',
  '#..........#',
  '.#........#.',
  '..########..',
];

// Folded/rounded ears — softer, and nothing comes to a single-cell point.
const frontRound = [
  '..##....##..',
  '.#..#..#..#.',
  '.#...##...#.',
  '##........##',
  '#..........#',
  '#.##....##.#',
  '#..........#',
  '#....##....#',
  '#..........#',
  '.#........#.',
  '..########..',
];

// Wider head, 14 cells across — the most detail this grid will hold.
const frontWide = [
  '.#..........#.',
  '.##........##.',
  '.#.#......#.#.',
  '##..######..##',
  '#............#',
  '#..##....##..#',
  '#............#',
  '#.....##.....#',
  '#............#',
  '.#..........#.',
  '..##########..',
];

// Smallest front head that still reads. No mouth — just two eyes.
// The ears keep the head's own outer wall and slope inwards, or at this size
// they merge into the skull and the whole thing reads as a frog.
const frontTiny = [
  '#........#',
  '##......##',
  '#.#....#.#',
  '#..####..#',
  '#........#',
  '#.#....#.#',
  '#........#',
  '.#......#.',
  '..######..',
];

// --- side views ---------------------------------------------------------

// Head in profile. The first attempt read as a wolf: the ears were tall and
// close together and the snout ran four cells past the jaw. Cat instead means
// ears set wide apart and a snout barely clear of the face.
const sideHead = [
  '#....#......',
  '##..##......',
  '#.#.#.#.....',
  '#...#..###..',
  '#.........#.',
  '#..#.......#',
  '#..........#',
  '.#.......##.',
  '.#....####..',
  '..#####.....',
];

// Sitting, seen from the side, with the tail curled round the front paws.
const sitting = [
  '.#..#.......',
  '.##.##......',
  '.#.#.#......',
  '#....##.....',
  '#..#...#....',
  '#......#....',
  '.#.....#....',
  '..#....#....',
  '..#.....#...',
  '..#......#..',
  '.#........#.',
  '.#.........#',
  '.#....###..#',
  '..#####..###',
];

// Walking, side on. Wider than tall, so it fills the tile differently.
const walking = [
  '.#..#.........',
  '.##.##........',
  '.#.#.#........',
  '#....#####....',
  '#..#......###.',
  '#............#',
  '.#..........#.',
  '.#.#..#..#..#.',
  '..#...#..#..#.',
  '...#..#..#..#.',
];

// Loaf: paws tucked, no legs showing. The squattest shape here.
const loaf = [
  '.#..#.........',
  '.##.##..####..',
  '.#.#.#.#....#.',
  '#....##......#',
  '#..#.........#',
  '#............#',
  '.#..........#.',
  '..##########..',
];

// Curled up asleep — a ring, with the tail closing the loop. Closed eye.
const sleeping = [
  '....######....',
  '..##......##..',
  '.#..........#.',
  '#....####....#',
  '#...#....#...#',
  '#.###.....#..#',
  '#..........#.#',
  '.#........#..#',
  '..##....##...#',
  '....####...##.',
];

// Head and shoulders, turned three-quarters. One ear reads nearer than the
// other, which is what sells the turn at this size. The outline has to close —
// the first pass left two stray cells trailing off the bottom-left corner and
// they read as damage, not as a shoulder.
const threeQuarter = [
  '.#.....#....',
  '.##...##....',
  '.#.#.#.#....',
  '##..#...#...',
  '#........#..',
  '#.#....#..#.',
  '#..........#',
  '#....##....#',
  '.#........#.',
  '..########..',
];

// Just the ears and the eyes — the head outline stops at the cheekbones.
const peeking = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#.##....##.#',
  '#..........#',
  '.##########.',
];

// Standing, tail up, seen from the side. The most "whole cat" of the set.
const standing = [
  '.#..#........#',
  '.##.##......#.',
  '.#.#.#......#.',
  '#....####...#.',
  '#..#.....##.#.',
  '#..........##.',
  '.#...........#',
  '.#..........#.',
  '..#.#..#..#.#.',
  '...#...#..#...',
];

// --- rendering ----------------------------------------------------------

// Centred on the 16-cell tile with offsets snapped to whole cells. A half-cell
// offset would put every edge back off the pixel grid, which is precisely the
// thing this grid exists to avoid.
function sprite(rows, ink) {
  const cols = rows[0].length;
  const cell = 512 / GRID;
  const offX = Math.round((GRID - cols) / 2);
  const offY = Math.round((GRID - rows.length) / 2);
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < cols; x++) {
      if (rows[y][x] !== '#') continue;
      // +0.5 overdraw closes the hairline seams antialiasing leaves between
      // neighbouring rects at fractional scales.
      out.push(
        `<rect x="${((x + offX) * cell).toFixed(2)}" y="${((y + offY) * cell).toFixed(2)}" ` +
          `width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}" fill="${ink}"/>`,
      );
    }
  }
  return out.join('');
}

const tileOf = (bg) => `<rect width="512" height="512" rx="112" fill="${bg}"/>`;
const make = (rows, { ink = INK, bg = TILE } = {}) => tileOf(bg) + sprite(rows, ink);

// Percentage of the tile the drawing spans — the "too big" number, made visible.
const cover = (rows) => Math.round((rows[0].length / GRID) * 100);

export const variantsB = [
  { name: 'Front', rows: front, note: 'Pointed ears, two eyes, small mouth. The straight answer in line art.' },
  { name: 'Front, round ears', rows: frontRound, note: 'Folded ears — nothing comes to a single-cell point, so nothing frays small.' },
  { name: 'Front, wide', rows: frontWide, note: '14 cells across: the most detail this grid will hold.' },
  { name: 'Front, tiny', rows: frontTiny, note: 'No mouth, just eyes. Smallest front head that still reads.' },
  { name: 'Side head →', rows: sideHead, note: 'Profile: sloping forehead, snout, jaw. One eye.' },
  { name: 'Side head ←', rows: mirror(sideHead), note: 'The same profile mirrored, in case it sits better facing left.' },
  { name: 'Sitting', rows: sitting, note: 'Side on, tail curled round the front paws. Tallest mark here.' },
  { name: 'Walking', rows: walking, note: 'Side on, four legs. Wider than tall, so it fills the tile differently.' },
  { name: 'Loaf', rows: loaf, note: 'Paws tucked, no legs. The squattest shape in the set.' },
  { name: 'Sleeping', rows: sleeping, note: 'Curled into a ring, tail closing the loop, eye shut.' },
  { name: 'Three-quarter', rows: threeQuarter, note: 'Head and shoulders, turned. One ear reads nearer than the other.' },
  { name: 'Standing', rows: standing, note: 'Tail up, side on. The most whole-cat option here.' },
].map((v) => ({ ...v, art: make(v.rows), cover: cover(v.rows) }));

export { make, sprite, cover, mirror };
