// Round four: forty line-art marks.
//
// The rules that survived from earlier rounds, and are not up for grabs:
//   - OUTLINE ONLY. A one-cell black edge, tile showing through, eye and mouth
//     in the same black. There is no fill character in this format on purpose.
//   - A 16-CELL TILE. 16 divides every icon size that matters, so one cell is
//     exactly 1px at 16px, 2px at 32, 4px at 64. The icon that first shipped
//     used an 18-cell tile (0.888px per cell), which is why it looked uneven in
//     the toolbar — and a thin outline shows that far worse than a solid shape.
//
// Forty hand-drawn grids would be forty chances to typo a row. So the front
// heads are built instead: four known-good head OUTLINES, each overlaid with
// three faces. The overlay is an OR of same-width strings, which cannot move a
// wall or leave a gap. Side views are mirrored rather than redrawn. Only the
// poses and the window motifs are drawn cell by cell.
//
//   '#' = ink   '.' = empty, tile shows through

export const TILE = '#ffffff';
export const INK = '#000000';
export const GRID = 16;

// --- helpers ------------------------------------------------------------

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

// OR a patch row into the base row. Same width both sides, enforced.
function overlay(base, patches) {
  return base.map((row, i) => {
    const patch = patches[i];
    if (!patch) return row;
    if (patch.length !== row.length) {
      throw new Error(`overlay row ${i}: patch ${patch.length} vs base ${row.length}`);
    }
    return [...row].map((c, x) => (patch[x] === '#' ? '#' : c)).join('');
  });
}

// --- four head outlines, no face ---------------------------------------

const headPointed = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '.#........#.',
  '..########..',
];

const headRound = [
  '..##....##..',
  '.#..#..#..#.',
  '.#...##...#.',
  '##........##',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '.#........#.',
  '..########..',
];

const headWide = [
  '.#..........#.',
  '.##........##.',
  '.#.#......#.#.',
  '##..######..##',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '.#..........#.',
  '..##########..',
];

const headSmall = [
  '#........#',
  '##......##',
  '#.#....#.#',
  '#..####..#',
  '#........#',
  '#........#',
  '#........#',
  '.#......#.',
  '..######..',
];

// --- three faces per head ----------------------------------------------
// Row 5 is the eye line on the 11-row heads, row 4 on the 9-row one.

const FACES_12 = {
  dots: { 5: '..#......#..' },
  wide: { 5: '..##....##..', 7: '.....##.....' },
  // Closed lids. They must not start against the head wall — at x=1 they fuse
  // with the outline and the cat reads as blindfolded rather than asleep.
  shut: { 5: '..###..###..', 7: '.....##.....' },
};

const FACES_14 = {
  dots: { 5: '...#......#...' },
  wide: { 5: '...##....##...', 7: '......##......' },
  shut: { 5: '..###....###..', 7: '......##......' },
};

const FACES_10 = {
  dots: { 4: '..#....#..' },
  wide: { 4: '..#....#..', 6: '...####...' },
  shut: { 4: '..##..##..', 6: '....##....' },
};

// Outline ears that sit ABOVE a window rectangle. Two diverging lines from a
// tip down to the frame, not a pair of nubs on the corners — the nub version
// read as battlements on a calendar, not as a cat, which is the whole point of
// putting a cat on a window in the first place.
const EARS_12 = [
  '..#......#..',
  '.#.#....#.#.',
  '#...#..#...#',
];

// --- side heads ---------------------------------------------------------

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

// Nose lifted, chin dropped — the same head looking upward.
const sideUp = [
  '#....#.....#',
  '##..##....#.',
  '#.#.#.#..#..',
  '#...#...#...',
  '#......#....',
  '#..#..#.....',
  '#....#......',
  '.#...#......',
  '.#....###...',
  '..#####..#..',
];

// Mouth open — mid-meow.
const sideMeow = [
  '#....#......',
  '##..##......',
  '#.#.#.#.....',
  '#...#..###..',
  '#.........#.',
  '#..#.......#',
  '#........###',
  '.#......#...',
  '.#.....####.',
  '..######....',
];

// --- poses --------------------------------------------------------------

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

const sittingTail = [
  '.#..#.......',
  '.##.##......',
  '.#.#.#......',
  '#....##.....',
  '#..#...#....',
  '#......#....',
  '.#.....#....',
  '..#....#..##',
  '..#.....#.#.',
  '..#......##.',
  '.#........#.',
  '.#........#.',
  '.#....###.#.',
  '..#####..##.',
];

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

const walking = [
  '.#..#.........',
  '.##.##..####..',
  '.#.#.#.#....#.',
  '#....##......#',
  '#............#',
  '.#..........#.',
  '.#.##.##.##.#.',
  '..#..#.#..#.#.',
];

const stretching = [
  '.#..#.........',
  '.##.##...###..',
  '.#.#.#.##...##',
  '#....##.......',
  '#.............',
  '.#............',
  '..###.........',
  '.....####.....',
  '.........###..',
  '...#..#....##.',
];

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

const pouncing = [
  '.#..#.........',
  '.##.##........',
  '.#.#.#..#####.',
  '#....###.....#',
  '#............#',
  '.#..........#.',
  '..#........#..',
  '.###......###.',
];

const jumping = [
  '......#....#..',
  '.....##....##.',
  '....#.#....#.#',
  '..###..####..#',
  '.#...........#',
  '#...........#.',
  '#..........#..',
  '.##......##...',
  '...######.....',
  '#.#.......#.#.',
];

// Seen from behind, tail up. Two ears and no face at all.
const backView = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#..........#',
  '#.......#..#',
  '#.......#..#',
  '#.......#..#',
  '.#......#.#.',
  '..###.###...',
];

const lying = [
  '..............',
  '.#..#.........',
  '.##.##...####.',
  '.#.#.#.##....#',
  '#....##.......',
  '#............#',
  '.############.',
  '..#..#..#..#..',
];

// Head and paws over a ledge — the ledge is the bottom edge of the tile.
const peeking = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#.#......#.#',
  '#..........#',
  '############',
  '.##......##.',
];

// --- window motifs ------------------------------------------------------
// Claufy tiles windows, so a mark that is part window is the only thing here
// that could not equally be somebody else's cat.

const windowEars = [
  ...EARS_12,
  '############',
  '#..........#',
  '############',
  '#..........#',
  '#..........#',
  '#..........#',
  '############',
];

// Two tiles stacked, wearing ears.
const stackEars = [
  ...EARS_12,
  '############',
  '#..........#',
  '#..........#',
  '############',
  '#..........#',
  '#..........#',
  '############',
];

// Four tiles; the whole grid wears the ears, so the layout is the cat.
const gridEars = [
  ...EARS_12,
  '############',
  '#....##....#',
  '#....##....#',
  '############',
  '#....##....#',
  '#....##....#',
  '############',
];

// A prompt: the chevron and the underscore, wearing ears.
const promptEars = [
  ...EARS_12,
  '############',
  '#..........#',
  '#.#........#',
  '#..#.......#',
  '#.#........#',
  '#...#####..#',
  '############',
];

// A window with a tail hanging out of the bottom-right corner.
const windowTail = [
  '############',
  '#..........#',
  '############',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#########..#',
  '........#..#',
  '........####',
];

// Two tiles side by side — the split view, wearing ears.
const splitEars = [
  ...EARS_12,
  '############',
  '#....##....#',
  '#....##....#',
  '#....##....#',
  '#....##....#',
  '#....##....#',
  '############',
];

// A cat face where the eyes are two tiles of a 2x2 grid.
const tileFace = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#.####..####',
  '#.#..#..#..#',
  '#.####..####',
  '#..........#',
  '############',
];

// Window bar with three lights, ears above.
const lightsEars = [
  ...EARS_12,
  '############',
  '#.#.#.#....#',
  '############',
  '#..........#',
  '#..........#',
  '#..........#',
  '############',
];

// A caret cursor beside a cat head — the blinking tile.
const caretCat = [
  '.#......#...',
  '.##....##...',
  '.#.#..#.#...',
  '##..##..##..',
  '#........#..',
  '#.#....#.#..',
  '#........#..',
  '#...##...#..',
  '.#......#..#',
  '..######...#',
];

// Whiskers, which nothing else in the set has.
const whiskers = [
  '.#........#.',
  '.##......##.',
  '.#.#....#.#.',
  '##..####..##',
  '#..........#',
  '#.#......#.#',
  '###......###',
  '#....##....#',
  '###......###',
  '.#........#.',
  '..########..',
];

// --- rendering ----------------------------------------------------------

function sprite(rows, ink) {
  const cols = rows[0].length;
  const cell = 512 / GRID;
  const offX = Math.round((GRID - cols) / 2);
  const offY = Math.round((GRID - rows.length) / 2);
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < cols; x++) {
      if (rows[y][x] !== '#') continue;
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
const cover = (rows) => Math.round((rows[0].length / GRID) * 100);

// Every sprite must be a rectangle, or a row silently shifts left.
function check(name, rows) {
  const w = rows[0].length;
  for (const r of rows) {
    if (r.length !== w) throw new Error(`${name}: ragged sprite (${r.length} vs ${w})`);
  }
  return rows;
}

const RAW = [
  ['Pointed · dots', overlay(headPointed, FACES_12.dots), 'The straight answer. Pointed ears, two dot eyes, no mouth.'],
  ['Pointed · eyes + mouth', overlay(headPointed, FACES_12.wide), 'Two-cell eyes and a small mouth. The fullest face on this head.'],
  ['Pointed · asleep', overlay(headPointed, FACES_12.shut), 'Lids instead of eyes. Calmer, and nothing to mistake for noise.'],
  ['Round ears · dots', overlay(headRound, FACES_12.dots), 'Folded ears, so nothing comes to a single-cell point.'],
  ['Round ears · eyes + mouth', overlay(headRound, FACES_12.wide), 'Softest silhouette here with a full face.'],
  ['Round ears · asleep', overlay(headRound, FACES_12.shut), 'Folded ears and shut eyes. The quietest mark in the set.'],
  ['Wide · dots', overlay(headWide, FACES_14.dots), '14 cells across — the most tile this grid will use.'],
  ['Wide · eyes + mouth', overlay(headWide, FACES_14.wide), 'Broad head, room for a proper face.'],
  ['Wide · asleep', overlay(headWide, FACES_14.shut), 'Wide and shut — reads almost like a logotype.'],
  ['Small · dots', overlay(headSmall, FACES_10.dots), 'Half the tile is air. The most zoomed-out head.'],
  ['Small · eyes + mouth', overlay(headSmall, FACES_10.wide), 'Tiny head, full face. Busiest at 16px.'],
  ['Small · asleep', overlay(headSmall, FACES_10.shut), 'Small and shut. Almost a punctuation mark.'],

  ['Side head →', sideHead, 'Profile: sloping forehead, short snout, one eye.'],
  ['Side head ←', mirror(sideHead), 'The same profile facing the other way.'],
  ['Looking up →', sideUp, 'Nose lifted, chin dropped. Reads as attention.'],
  ['Looking up ←', mirror(sideUp), 'Mirrored, in case it sits better facing left.'],
  ['Meow →', sideMeow, 'Mouth open mid-meow. The only talking cat here.'],
  ['Meow ←', mirror(sideMeow), 'Mirrored meow.'],

  ['Sitting', sitting, 'Side on, tail curled round the front paws.'],
  ['Sitting, tail up', sittingTail, 'Same pose, tail raised behind instead of curled.'],
  ['Standing', standing, 'Four legs, tail up. The most whole-cat option.'],
  ['Walking', walking, 'Mid-stride. Wider than tall, fills the tile differently.'],
  ['Stretching', stretching, 'Front legs out, back arched. The longest shape here.'],
  ['Loaf', loaf, 'Paws tucked, no legs. The squattest shape here.'],
  ['Sleeping', sleeping, 'Curled into a ring, tail closing the loop.'],
  ['Pouncing', pouncing, 'Crouched, about to go. Low and wide.'],
  ['Jumping', jumping, 'Mid-air, legs out. The most motion in the set.'],
  ['From behind', backView, 'Seen from the back, tail up. No face at all.'],
  ['Lying down', lying, 'Flat out on one side.'],
  ['Peeking', peeking, 'Head and paws over a ledge. The ledge is the tile edge.'],
  ['Three-quarter', overlay(headPointed, { 5: '..#....#....', 7: '....##......' }), 'Face turned — the features sit off centre, the head does not.'],
  ['Whiskers', whiskers, 'The only one with whiskers. They cost two cells a side.'],

  ['Window + ears', windowEars, 'A window with ears. Half the product, half the cat.'],
  ['Stacked tiles + ears', stackEars, 'Two tiles one above the other, wearing ears.'],
  ['Grid + ears', gridEars, 'Four tiles wearing ears — the layout itself is the cat.'],
  ['Prompt + ears', promptEars, 'A shell prompt with ears. The most terminal of the set.'],
  ['Window + tail', windowTail, 'A tail slipping out of the bottom corner of a window.'],
  ['Split + ears', splitEars, 'Two tiles side by side, ears over the left one.'],
  ['Tile eyes', tileFace, 'The eyes are two tiles of a grid. Cat and layout in one shape.'],
  ['Title bar + ears', lightsEars, 'Three window lights under a pair of ears.'],
  ['Caret + cat', caretCat, 'A blinking cursor beside the head.'],
];

export const variantsB = RAW.map(([name, rows, note], i) => {
  check(`#${i + 1} ${name}`, rows);
  return { name, rows, note, art: make(rows), cover: cover(rows) };
});

export { make, sprite, cover, mirror, overlay };
