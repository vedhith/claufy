// Claufy renderer. Owns the tiles and the layout; shells live in the main
// process behind the `claufy` bridge.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type Mode = 'stage' | 'equal' | 'grow' | 'solo';

type Pane = {
  id: string;
  kind: 'term' | 'page';
  title: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
  // Stage mode only: 0 is the centre, 1..n-1 are the side rails. A swap is two
  // panes exchanging this number; nothing else in the layout moves.
  slot: number;
  term?: Terminal;
  fit?: FitAddon;
  dead?: boolean;
};

declare global {
  interface Window {
    claufy: {
      ptyAvailable(): Promise<{ ok: boolean; error: string | null }>;
      spawn(o: { id: string; cwd?: string; cols: number; rows: number; command?: string }): Promise<{ ok: boolean; error?: string }>;
      write(id: string, data: string): void;
      resize(id: string, cols: number, rows: number): void;
      kill(id: string): void;
      onData(id: string, cb: (d: string) => void): void;
      onExit(id: string, cb: (code: number) => void): void;
      offPane(id: string): void;
      pickFolder(): Promise<string | null>;
      homedir(): Promise<string>;
      openExternal(t: string): Promise<{ ok: boolean; error?: string }>;
      platform: string;
    };
  }
}

const grid = document.getElementById('grid') as HTMLDivElement;
const empty = document.getElementById('empty') as HTMLDivElement;
const bar = document.getElementById('bar') as HTMLElement;
const modeSel = document.getElementById('mode') as HTMLSelectElement;
const ratioInput = document.getElementById('ratio') as HTMLInputElement;
const sizeWrap = document.getElementById('size-wrap') as HTMLLabelElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const pageDialog = document.getElementById('page-dialog') as HTMLDialogElement;
const pageUrl = document.getElementById('page-url') as HTMLInputElement;

const panes: Pane[] = [];
const gotData = new Set<string>();
const spawnErrors: string[] = [];
let activeId: string | null = null;
let seq = 0;
let ptyOk = false;
let ptyErr: string | null = null;

const isMac = window.claufy.platform === 'darwin';
if (isMac) bar.classList.add('mac');
const modKeyLabel = isMac ? 'Cmd' : 'Ctrl';
const newkey = document.getElementById('newkey');
if (newkey) newkey.textContent = modKeyLabel;

// --- theme --------------------------------------------------------------

// Read out of ~/Library/Preferences/com.apple.Terminal.plist, profile
// "Clear Dark". Kept as literals rather than read at runtime so the app looks
// the same on a machine that has no Terminal.app.
const TERM_THEME = {
  background: '#191d27',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#191d27',
  selectionBackground: '#273d4c',
  black: '#35424c',
  red: '#b45648',
  green: '#6caa71',
  yellow: '#c4ac62',
  blue: '#6d96b4',
  magenta: '#bd7bcd',
  cyan: '#7ccbcd',
  white: '#dee5eb',
  brightBlack: '#465c6d',
  brightRed: '#df6c5a',
  brightGreen: '#79be7e',
  brightYellow: '#e5c872',
  brightBlue: '#67b5ed',
  brightMagenta: '#d389e5',
  brightCyan: '#84dde0',
  brightWhite: '#e5eff5',
} as const;

// --- settings -----------------------------------------------------------

type Settings = { mode: Mode; ratio: number };
const DEFAULTS: Settings = { mode: 'stage', ratio: 2.2 };
const MODES: Mode[] = ['stage', 'equal', 'grow', 'solo'];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('claufy:settings');
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const mode: Mode = MODES.includes(s.mode as Mode) ? (s.mode as Mode) : DEFAULTS.mode;
    const ratio = typeof s.ratio === 'number' && s.ratio >= 1 && s.ratio <= 6 ? s.ratio : DEFAULTS.ratio;
    return { mode, ratio };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try { localStorage.setItem('claufy:settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

modeSel.value = settings.mode;
ratioInput.value = String(settings.ratio);
sizeWrap.style.visibility = settings.mode === 'grow' ? 'visible' : 'hidden';

modeSel.addEventListener('change', () => {
  settings.mode = modeSel.value as Mode;
  sizeWrap.style.visibility = settings.mode === 'grow' ? 'visible' : 'hidden';
  saveSettings();
  stageTheActive();
  layout();
});

ratioInput.addEventListener('input', () => {
  settings.ratio = Number(ratioInput.value);
  saveSettings();
  layout();
});

// --- layout -------------------------------------------------------------

// Same shape as an even grid: as square as possible, filling left to right.
function gridShape(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

function tracks(count: number, hot: number, mode: Mode, ratio: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (mode === 'equal' || hot < 0) out.push('1fr');
    else if (mode === 'solo') out.push(i === hot ? '1fr' : '0fr');
    else out.push(i === hot ? `${ratio}fr` : '1fr');
  }
  return out.join(' ');
}

// --- stage mode ---------------------------------------------------------

// One tile at full size in the middle, the rest small down the sides — still
// live, still readable. Picking a small one does not re-space the window the
// way Grow does: the two tiles trade places and nothing else moves.

// How wide a rail is. A percentage alone goes unusable on a small window and a
// fixed width eats half a big one, so it is clamped at both ends.
const RAIL = 'clamp(128px, 17%, 240px)';

const SWAP_MS = 380;
const SWAP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// Rail slots alternate right, left, right, left, so the stage sits as near the
// middle as the count allows: two tiles hang one rail off the right, three
// balance it, and it stays balanced from there.
function railOf(slot: number): { right: boolean; row: number } {
  return { right: slot % 2 === 1, row: Math.floor((slot - 1) / 2) };
}

// Slots have to stay a dense 0..n-1 after a close, and whoever was nearest the
// centre inherits the stage.
function normalizeSlots() {
  [...panes].sort((a, b) => a.slot - b.slot).forEach((p, i) => { p.slot = i; });
}

// Entering Stage from another mode: the tile you were in is the one you meant
// to be looking at, so it takes the centre.
function stageTheActive() {
  if (settings.mode !== 'stage' || !activeId) return;
  const p = panes.find((x) => x.id === activeId);
  const st = panes.find((x) => x.slot === 0);
  if (p && st && p !== st) { st.slot = p.slot; p.slot = 0; }
}

function layoutStage() {
  const sides = panes.length - 1;
  const rightCount = Math.ceil(sides / 2);
  const leftCount = Math.floor(sides / 2);
  const rows = Math.max(rightCount, 1);

  // Only the rails that hold something get a column. An empty one would be a
  // stripe of background plus a gap, which reads as a bug rather than a rail.
  let leftCol = 0;
  let stageCol = 1;
  let rightCol = 0;
  if (sides === 0) {
    grid.style.gridTemplateColumns = '1fr';
  } else if (leftCount === 0) {
    grid.style.gridTemplateColumns = `1fr ${RAIL}`;
    rightCol = 2;
  } else {
    grid.style.gridTemplateColumns = `${RAIL} 1fr ${RAIL}`;
    leftCol = 1;
    stageCol = 2;
    rightCol = 3;
  }
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  for (const p of panes) {
    p.el.classList.toggle('active', p.id === activeId);
    p.el.classList.remove('collapsed');
    p.el.classList.toggle('rail', p.slot !== 0);
    if (p.slot === 0) {
      p.el.style.gridColumn = String(stageCol);
      p.el.style.gridRow = '1 / -1';
    } else {
      const { right, row } = railOf(p.slot);
      // The last tile in a rail runs to the bottom, so a short rail fills its
      // column instead of leaving a hole under it.
      const last = row === (right ? rightCount : leftCount) - 1;
      p.el.style.gridColumn = String(right ? rightCol : leftCol);
      p.el.style.gridRow = `${row + 1} / ${last ? '-1' : String(row + 2)}`;
    }
  }
}

// A tile mid-flight. Kept so a second click can cancel the first rather than
// stacking two animations on one element.
const flights = new WeakMap<HTMLElement, Animation>();

function stopFlight(el: HTMLElement) {
  const a = flights.get(el);
  if (a) { a.cancel(); flights.delete(el); }
}

// Carry a tile from where it was to where it now is. Width and height animate
// and a plain translate moves it — nothing is ever scaled, because a scaled
// terminal is a resampled one and the glyphs turn to mush. The content is
// clipped and revealed instead, which stays sharp at every frame.
function slide(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (!dx && !dy && from.width === to.width && from.height === to.height) return;

  el.style.zIndex = '3';
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, width: `${from.width}px`, height: `${from.height}px` },
      { transform: 'none', width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: SWAP_MS, easing: SWAP_EASE },
  );
  flights.set(el, anim);
  const done = () => {
    if (flights.get(el) === anim) { flights.delete(el); el.style.zIndex = ''; }
  };
  // cancel() rejects this promise; both endings clean up the same way.
  anim.finished.then(done, done);
}

function swapWithStage(p: Pane, animate: boolean) {
  const st = panes.find((x) => x.slot === 0);
  if (!st || st === p) return;

  const moving = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Measured live, so a click during a swap flies on from where the tile
  // actually is rather than snapping back first.
  const from = moving ? [st.el.getBoundingClientRect(), p.el.getBoundingClientRect()] : null;
  if (moving) { stopFlight(st.el); stopFlight(p.el); }

  const s = st.slot;
  st.slot = p.slot;
  p.slot = s;
  activeId = p.id;
  layout();

  if (from) {
    slide(st.el, from[0]);
    slide(p.el, from[1]);
  }
  p.term?.focus();
}

// --- layout -------------------------------------------------------------

function layout() {
  const n = panes.length;
  empty.classList.toggle('show', n === 0);
  grid.classList.toggle('stage', settings.mode === 'stage');
  if (n === 0) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows = '1fr';
    return;
  }

  if (settings.mode === 'stage') {
    layoutStage();
    return;
  }

  // Every other mode is auto-flow, so the stage's explicit placement has to go.
  for (const p of panes) {
    p.el.style.gridColumn = '';
    p.el.style.gridRow = '';
    p.el.classList.remove('rail');
  }

  const { cols, rows } = gridShape(n);
  const idx = activeId ? panes.findIndex((p) => p.id === activeId) : -1;
  const hotCol = idx >= 0 ? idx % cols : -1;
  const hotRow = idx >= 0 ? Math.floor(idx / cols) : -1;

  grid.style.gridTemplateColumns = tracks(cols, hotCol, settings.mode, settings.ratio);
  grid.style.gridTemplateRows = tracks(rows, hotRow, settings.mode, settings.ratio);

  for (let i = 0; i < panes.length; i++) {
    const p = panes[i];
    p.el.classList.toggle('active', p.id === activeId);
    // In Solo the other tracks go to zero; fade them so no sliver flickers.
    p.el.classList.toggle('collapsed', settings.mode === 'solo' && idx >= 0 && p.id !== activeId);
  }
}

// `animate` is off for tiles that appear or disappear: the grid tracks are
// already moving underneath them, so a flight measured against them lands wrong.
function setActive(id: string, animate = true) {
  const p = panes.find((x) => x.id === id);
  if (!p) return;
  if (settings.mode === 'stage' && p.slot !== 0) {
    swapWithStage(p, animate);
    return;
  }
  if (activeId === id) return;
  activeId = id;
  layout();
  p.term?.focus();
}

// --- panes --------------------------------------------------------------

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function makePane(kind: Pane['kind'], title: string): Pane {
  const el = document.createElement('div');
  el.className = 'pane';

  const head = document.createElement('div');
  head.className = 'pane-head';

  const dot = document.createElement('span');
  dot.className = 'dot';

  const label = document.createElement('span');
  label.className = 'pane-title';
  label.textContent = title;

  const close = document.createElement('button');
  close.className = 'pane-close';
  close.textContent = '✕';
  close.title = 'Close tile';

  head.append(dot, label, close);

  const body = document.createElement('div');
  body.className = 'pane-body';

  el.append(head, body);

  const pane: Pane = { id: `p${++seq}`, kind, title, el, body, slot: panes.length };

  // Not on the close button: promoting a tile you are in the act of closing
  // would fly it to the centre and then delete it.
  el.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement | null)?.closest('.pane-close')) return;
    setActive(pane.id);
  });
  // Double-clicking the header is the fast way to blow one tile up and back.
  head.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setActive(pane.id);
    toggleSolo();
  });
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane.id);
  });

  panes.push(pane);
  // A tile you just opened is the one you want to look at, so it lands on the
  // stage and the tile it displaces takes the rail slot it would have had.
  if (settings.mode === 'stage') {
    const st = panes.find((x) => x.slot === 0 && x !== pane);
    if (st) { st.slot = pane.slot; pane.slot = 0; }
  }
  grid.append(el);
  return pane;
}

function closePane(id: string) {
  const i = panes.findIndex((p) => p.id === id);
  if (i < 0) return;
  const p = panes[i];
  if (p.kind === 'term') {
    window.claufy.kill(p.id);
    window.claufy.offPane(p.id);
    try { p.term?.dispose(); } catch { /* already disposed */ }
  }
  p.el.remove();
  panes.splice(i, 1);
  normalizeSlots();
  if (activeId === id) {
    // In Stage the centre is never empty: whoever normalising moved into slot 0
    // is the tile you are now looking at.
    activeId = !panes.length
      ? null
      : settings.mode === 'stage'
        ? panes.find((x) => x.slot === 0)!.id
        : panes[Math.min(i, panes.length - 1)].id;
  }
  layout();
  if (activeId) panes.find((x) => x.id === activeId)?.term?.focus();
}

async function addTerminal(cwd?: string, command?: string) {
  const title = cwd ? shortPath(cwd) : 'terminal';
  const pane = makePane('term', title);

  if (!ptyOk) {
    const err = document.createElement('div');
    err.className = 'pane-error';
    err.textContent =
      'Terminals unavailable — node-pty did not load.\n\n' +
      (ptyErr ?? 'unknown error') +
      '\n\nRun: npm run rebuild';
    pane.body.append(err);
    setActive(pane.id);
    layout();
    return;
  }

  const host = document.createElement('div');
  host.className = 'term-host';
  pane.body.append(host);

  const term = new Terminal({
    // Font, size and the whole palette are the user's Terminal.app "Clear Dark"
    // profile, so a tile is indistinguishable from the window it replaces.
    fontSize: 12,
    fontFamily: '"JetBrainsMono NFP Thin", "JetBrainsMono Nerd Font Propo", "JetBrains Mono", ui-monospace, Menlo, monospace',
    cursorBlink: true,
    allowProposedApi: true,
    theme: TERM_THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  pane.term = term;
  pane.fit = fit;

  layout();
  // Let the grid settle before measuring, or the first fit is a wrong size.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { fit.fit(); } catch { /* zero-sized while animating */ }

  const res = await window.claufy.spawn({
    id: pane.id,
    cwd,
    cols: term.cols,
    rows: term.rows,
    command,
  });

  if (!res.ok) {
    spawnErrors.push(res.error ?? 'unknown');
    term.write(`\r\n\x1b[31mCould not start a shell: ${res.error ?? 'unknown'}\x1b[0m\r\n`);
    pane.dead = true;
    pane.el.classList.add('dead');
    return;
  }

  window.claufy.onData(pane.id, (d) => { gotData.add(pane.id); term.write(d); });
  window.claufy.onExit(pane.id, () => {
    pane.dead = true;
    pane.el.classList.add('dead');
    term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
  });
  term.onData((d) => window.claufy.write(pane.id, d));
  term.onTitleChange((t) => {
    if (t && t.trim()) {
      pane.title = t.trim();
      const lbl = pane.el.querySelector('.pane-title');
      if (lbl) lbl.textContent = pane.title;
    }
  });

  // Refit continuously while the grid animates, so text reflows with the tile.
  const ro = new ResizeObserver(() => {
    if (!pane.fit) return;
    try {
      pane.fit.fit();
      window.claufy.resize(pane.id, term.cols, term.rows);
    } catch { /* mid-animation zero size */ }
  });
  ro.observe(host);

  setActive(pane.id);
  term.focus();
}

function addPage(url: string) {
  let target = url.trim();
  if (!target) return;
  if (!/^[a-z]+:\/\//i.test(target)) target = 'https://' + target;

  let host: string;
  try { host = new URL(target).host; } catch { toast('That does not look like a URL.'); return; }

  const pane = makePane('page', host);
  const view = document.createElement('webview');
  view.setAttribute('src', target);
  view.setAttribute('allowpopups', 'false');
  pane.body.append(view);
  setActive(pane.id);
  layout();
}

// --- solo toggle --------------------------------------------------------

let modeBeforeSolo: Mode | null = null;

function toggleSolo() {
  if (settings.mode === 'solo') {
    settings.mode = modeBeforeSolo ?? DEFAULTS.mode;
    modeBeforeSolo = null;
  } else {
    modeBeforeSolo = settings.mode;
    settings.mode = 'solo';
  }
  modeSel.value = settings.mode;
  sizeWrap.style.visibility = settings.mode === 'grow' ? 'visible' : 'hidden';
  saveSettings();
  stageTheActive();
  layout();
}

// --- chrome -------------------------------------------------------------

let toastTimer: number | undefined;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

document.getElementById('add-term')!.addEventListener('click', () => void addTerminal());
document.getElementById('add-term-dir')!.addEventListener('click', async () => {
  const dir = await window.claufy.pickFolder();
  if (dir) void addTerminal(dir);
});
document.getElementById('add-page')!.addEventListener('click', () => {
  pageUrl.value = '';
  pageDialog.showModal();
  pageUrl.focus();
});

pageDialog.addEventListener('close', () => {
  if (pageDialog.returnValue === 'ok') addPage(pageUrl.value);
});

window.addEventListener(
  'keydown',
  (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) {
      if (e.key === 'Escape' && settings.mode === 'solo') {
        e.preventDefault();
        toggleSolo();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); void addTerminal(); }
    else if (k === 'w') { e.preventDefault(); if (activeId) closePane(activeId); }
    else if (e.key === 'Enter') { e.preventDefault(); toggleSolo(); }
    else if (k >= '1' && k <= '9') {
      const i = Number(k) - 1;
      if (panes[i]) { e.preventDefault(); setActive(panes[i].id); }
    }
  },
  true,
);

window.addEventListener('resize', () => {
  for (const p of panes) {
    try {
      p.fit?.fit();
      if (p.term) window.claufy.resize(p.id, p.term.cols, p.term.rows);
    } catch { /* hidden pane */ }
  }
});

// --- smoke test ---------------------------------------------------------

// Everything the terminal has painted, as plain text. Only used by the smoke
// test, to read what a real shell actually replied.
function paneText(p: Pane): string {
  const b = p.term?.buffer.active;
  if (!b) return '';
  const out: string[] = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
  return out.join('\n');
}

// Exercised by CLAUFY_SMOKE from the main process. Drives the same functions
// the UI does, so a pass means the real paths work, not a mock of them.
(window as unknown as { __claufySmoke: () => Promise<unknown> }).__claufySmoke = async () => {
  const settle = () => new Promise((r) => setTimeout(r, 260));

  await addTerminal();
  await addTerminal();
  await addTerminal();
  await settle();

  const shape = gridShape(panes.length);
  const seen: Record<string, { cols: string; rows: string }> = {};

  for (const m of ['equal', 'grow', 'solo', 'stage'] as Mode[]) {
    settings.mode = m;
    layout();
    await settle();
    seen[m] = {
      cols: grid.style.gridTemplateColumns,
      rows: grid.style.gridTemplateRows,
    };
  }

  // Stage's promise is a trade, not a re-space: the tile you click must land on
  // exactly the centre's box and the centre must land on exactly its old one.
  // Measured, because "it animates" is not a claim you can eyeball into a log.
  const box = (p: Pane) => {
    const r = p.el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const centre = panes.find((p) => p.slot === 0)!;
  const rail = panes.find((p) => p.slot === 1)!;
  const wasCentre = box(centre);
  const wasRail = box(rail);
  const others = panes.filter((p) => p !== centre && p !== rail).map(box);
  setActive(rail.id);
  await new Promise((r) => setTimeout(r, SWAP_MS + 320));
  const stageSwap = {
    railTookCentre: JSON.stringify(box(rail)) === JSON.stringify(wasCentre),
    centreTookRail: JSON.stringify(box(centre)) === JSON.stringify(wasRail),
    restStayedPut:
      JSON.stringify(panes.filter((p) => p !== centre && p !== rail).map(box)) === JSON.stringify(others),
    railsStayVisible: panes.every((p) => box(p).w > 0 && box(p).h > 0),
    centre: wasCentre,
    rail: wasRail,
  };

  settings.mode = 'grow';
  layout();

  const sized = panes.map((p) => {
    const r = p.el.getBoundingClientRect();
    return { id: p.id, w: Math.round(r.width), h: Math.round(r.height) };
  });

  // Scope probe: open a tile in a real folder and ask the shell inside it what
  // `claude agents` resolves to. This is the only way to prove the ZDOTDIR
  // wrapper survives the user's own rc.
  let scopeProbe: string[] | null = null;
  const probeDir = (window as unknown as { __claufyProbeDir?: string }).__claufyProbeDir;
  if (probeDir) {
    await addTerminal(
      probeDir,
      'echo "DIR=$CLAUFY_DIR"; echo "WRAPPED=$(functions claude | grep -c -- --cwd)"; echo "ISFUNC=$(type -w claude)"',
    );
    await new Promise((r) => setTimeout(r, 5000));
    const p = panes[panes.length - 1];
    scopeProbe = paneText(p).split('\n').map((l) => l.trim()).filter(Boolean).slice(-8);
  }

  const fontFamily = '"JetBrainsMono NFP Thin"';
  return {
    scopeProbe,
    fontLoaded: document.fonts.check(`12px ${fontFamily}`),
    bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
    bg: getComputedStyle(document.body).backgroundColor,
    ptyOk,
    ptyErr,
    panes: panes.length,
    shape,
    templates: seen,
    stageSwap,
    shellsProducedOutput: gotData.size,
    spawnErrors,
    dead: panes.filter((p) => p.dead).length,
    titles: panes.map((p) => p.title),
    rects: sized,
    activeIsBigger:
      sized.length > 1 && activeId
        ? (() => {
            const a = sized.find((s) => s.id === activeId);
            if (!a) return null; // probe opened a tile after this was measured
            const others = sized.filter((s) => s.id !== activeId);
            return others.every((o) => a.w * a.h >= o.w * o.h);
          })()
        : null,
  };
};

// --- boot ---------------------------------------------------------------

(async () => {
  const status = await window.claufy.ptyAvailable();
  ptyOk = status.ok;
  ptyErr = status.error;
  layout();
  if (!ptyOk) toast('Terminals unavailable — run npm run rebuild');
  else await addTerminal();
})();
