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
  view?: WebviewTag;
  cwd?: string;
  url?: string;
  dead?: boolean;
};

// The handful of <webview> methods used here. Electron ships types for the tag
// but pulling them in would mean depending on electron from the renderer.
type WebviewTag = HTMLElement & {
  copy(): void;
  paste(): void;
  selectAll(): void;
};

declare global {
  interface Window {
    claufy: {
      ptyAvailable(): Promise<{ ok: boolean; error: string | null }>;
      spawn(o: { id: string; cwd?: string; cols: number; rows: number; command?: string }): Promise<{ ok: boolean; error?: string; cwd?: string }>;
      write(id: string, data: string): void;
      resize(id: string, cols: number, rows: number): void;
      kill(id: string): void;
      onData(id: string, cb: (d: string) => void): void;
      onExit(id: string, cb: (code: number) => void): void;
      offPane(id: string): void;
      pickFolder(): Promise<string | null>;
      homedir(): Promise<string>;
      openExternal(t: string): Promise<{ ok: boolean; error?: string }>;
      clipboardRead(which?: 'clipboard' | 'selection'): Promise<string>;
      clipboardWrite(text: string, which?: 'clipboard' | 'selection'): void;
      contextMenu(info: { hasSelection: boolean; kind: 'term' | 'page'; link?: string }): void;
      onCommand(cb: (cmd: string) => void): void;
      filePath(f: File): string;
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
// On Windows and Linux every bare Ctrl chord belongs to the shell, so the app
// takes Ctrl+Shift there. The hint has to say which one this machine uses.
const newTileKey = isMac ? 'Cmd' : 'Ctrl+Shift';
const newkey = document.getElementById('newkey');
if (newkey) newkey.textContent = newTileKey;
const addTermBtn = document.getElementById('add-term');
if (addTermBtn) addTermBtn.title = `New terminal (${newTileKey}+T)`;

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

type Settings = { mode: Mode; ratio: number; fontSize: number };
const DEFAULTS: Settings = { mode: 'stage', ratio: 2.2, fontSize: 12 };
const MODES: Mode[] = ['stage', 'equal', 'grow', 'solo'];
const FONT_MIN = 8;
const FONT_MAX = 28;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('claufy:settings');
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const mode: Mode = MODES.includes(s.mode as Mode) ? (s.mode as Mode) : DEFAULTS.mode;
    const ratio = typeof s.ratio === 'number' && s.ratio >= 1 && s.ratio <= 6 ? s.ratio : DEFAULTS.ratio;
    const fontSize =
      typeof s.fontSize === 'number' && s.fontSize >= FONT_MIN && s.fontSize <= FONT_MAX
        ? s.fontSize
        : DEFAULTS.fontSize;
    return { mode, ratio, fontSize };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try { localStorage.setItem('claufy:settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

// --- workspace persistence ---------------------------------------------

type WorkspaceTile =
  | { kind: 'term'; cwd?: string }
  | { kind: 'page'; url: string };

type Workspace = {
  version: 1;
  tiles: WorkspaceTile[];
  stageIndex: number;
  activeIndex: number;
};

const WORKSPACE_KEY = 'claufy:workspace';
const WORKSPACE_VERSION = 1;
const MAX_WORKSPACE_TILES = 64;
const MAX_WORKSPACE_VALUE = 32_768;
let workspaceSavesPaused = 0;

function validWorkspaceString(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_WORKSPACE_VALUE &&
    value.length > 0 &&
    !value.includes('\0');
}

function parseWorkspace(raw: string | null): Workspace | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== WORKSPACE_VERSION || !Array.isArray(candidate.tiles)) return null;
    if (candidate.tiles.length > MAX_WORKSPACE_TILES) return null;

    const tiles: WorkspaceTile[] = [];
    for (const item of candidate.tiles) {
      if (!item || typeof item !== 'object') return null;
      const tile = item as Record<string, unknown>;
      if (tile.kind === 'term') {
        if (tile.cwd !== undefined && !validWorkspaceString(tile.cwd)) return null;
        tiles.push(tile.cwd === undefined ? { kind: 'term' } : { kind: 'term', cwd: tile.cwd });
      } else if (tile.kind === 'page') {
        if (!validWorkspaceString(tile.url)) return null;
        try { new URL(tile.url); } catch { return null; }
        tiles.push({ kind: 'page', url: tile.url });
      } else {
        return null;
      }
    }

    const stageIndex = candidate.stageIndex;
    const activeIndex = candidate.activeIndex;
    if (!Number.isInteger(stageIndex) || !Number.isInteger(activeIndex)) return null;
    if (tiles.length === 0) {
      if (stageIndex !== -1 || activeIndex !== -1) return null;
    } else if (
      (stageIndex as number) < 0 || (stageIndex as number) >= tiles.length ||
      (activeIndex as number) < 0 || (activeIndex as number) >= tiles.length
    ) {
      return null;
    }

    return {
      version: WORKSPACE_VERSION,
      tiles,
      stageIndex: stageIndex as number,
      activeIndex: activeIndex as number,
    };
  } catch {
    return null;
  }
}

function serializeWorkspace(): Workspace {
  const stageIndex = panes.findIndex((pane) => pane.slot === 0);
  const activeIndex = activeId ? panes.findIndex((pane) => pane.id === activeId) : -1;
  return {
    version: WORKSPACE_VERSION,
    tiles: panes.map((pane): WorkspaceTile => pane.kind === 'term'
      ? (pane.cwd ? { kind: 'term', cwd: pane.cwd } : { kind: 'term' })
      : { kind: 'page', url: pane.url || 'about:blank' }),
    stageIndex: panes.length ? Math.max(0, stageIndex) : -1,
    activeIndex: panes.length ? Math.max(0, activeIndex) : -1,
  };
}

function saveWorkspace() {
  if (workspaceSavesPaused) return;
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace())); } catch { /* private mode */ }
}

function loadWorkspace(): Workspace | null {
  try { return parseWorkspace(localStorage.getItem(WORKSPACE_KEY)); } catch { return null; }
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
  saveWorkspace();
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
  // Delete before cancelling: cancel() rejects the finished promise, and the
  // handler there only tidies up if it is still the current flight.
  if (a) { flights.delete(el); a.cancel(); }
  el.style.zIndex = '';
}

// Any layout that is not a swap invalidates every flight in progress — the
// target slot it was flying to may not even exist any more. Closing a tile,
// entering Solo and changing mode all land here, so cancelling once in
// `layout()` covers all of them. A cancelled tile snaps to where it belongs,
// which is always better than arriving somewhere that has moved.
function stopAllFlights() {
  for (const p of panes) stopFlight(p.el);
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

// A tile that opens goes straight to slot 0 in makePane rather than through
// here, so this is only ever a click, a key, or the smoke test — and always
// animates unless the machine has asked it not to.
function swapWithStage(p: Pane) {
  const st = panes.find((x) => x.slot === 0);
  if (!st || st === p) return;

  const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Measured live and before `layout()` cancels the flights, so a click during
  // a swap carries on from where the tile actually is rather than snapping back.
  const from = moving ? [st.el.getBoundingClientRect(), p.el.getBoundingClientRect()] : null;

  const s = st.slot;
  st.slot = p.slot;
  p.slot = s;
  activeId = p.id;
  layout();
  saveWorkspace();

  if (from) {
    slide(st.el, from[0]);
    slide(p.el, from[1]);
  }
  p.term?.focus();
}

// --- layout -------------------------------------------------------------

function layout() {
  const n = panes.length;
  // A swap cancels these itself and then re-arms them after this returns, so
  // this only ever kills a flight the new layout has already invalidated.
  stopAllFlights();
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

function setActive(id: string) {
  const p = panes.find((x) => x.id === id);
  if (!p) return;
  if (settings.mode === 'stage' && p.slot !== 0) {
    swapWithStage(p);
    return;
  }
  if (activeId === id) return;
  activeId = id;
  layout();
  saveWorkspace();
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

  // Pointer events inside a <webview> never reach the embedder, so a page tile
  // on a rail could not be clicked into the middle — only its header worked,
  // which is not what "click the small one" means. This sheet sits over the
  // body and takes the click instead. CSS shows it only on a Stage rail, so a
  // page in the middle is fully interactive.
  const catcher = document.createElement('div');
  catcher.className = 'pane-catch';
  body.append(catcher);

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
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setActive(pane.id);
    window.claufy.contextMenu({
      hasSelection: pane.term ? pane.term.hasSelection() : true,
      kind: pane.kind,
      link: hoveredLink.get(pane.id),
    });
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
  saveWorkspace();
  focusPane(activePane());
}

function activePane(): Pane | undefined {
  return activeId ? panes.find((p) => p.id === activeId) : undefined;
}

function focusPane(p: Pane | undefined) {
  if (!p) return;
  if (p.term) p.term.focus();
  else p.view?.focus();
}

// --- terminal parity ----------------------------------------------------

// Everything below exists because a tile has to behave like the terminal
// window it replaces. xterm draws its own selection on its own canvas, so the
// browser's Copy has nothing to copy and the platform's Paste has nowhere to
// put it — both have to be wired by hand.

const isLinux = window.claufy.platform === 'linux';

// Where the pointer is resting, if it is resting on a link. Right-click reads
// it so "Open Link" can appear the way it does in Terminal.app.
const hoveredLink = new Map<string, string>();

function copyFrom(pane: Pane): boolean {
  if (pane.term) {
    const text = pane.term.getSelection();
    if (!text) return false;
    window.claufy.clipboardWrite(text);
    return true;
  }
  pane.view?.copy();
  return true;
}

async function pasteInto(pane: Pane, which?: 'clipboard' | 'selection') {
  if (!pane.term) { pane.view?.paste(); return; }
  const text = await window.claufy.clipboardRead(which);
  if (text) pane.term.paste(text);
}

// Quote a dropped path the way a shell needs it, so a folder with a space in
// its name is one argument rather than two.
function shellQuote(p: string): string {
  if (window.claufy.platform === 'win32') return /[\s&()[\]{}^=;!'+,`~]/.test(p) ? `"${p}"` : p;
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s"'`<>\\^{}|]+/g;

type FoundLink = {
  url: string;
  href: string;
  startX: number; startY: number;
  endX: number; endY: number;
};

// Split out of the link provider so the wrap arithmetic can be checked
// directly — it is the part most likely to be subtly wrong. `text` is the
// whole logical line, untrimmed, so every row in it is exactly `cols` wide and
// mapping an offset back to a row is a division. Coordinates come back 1-based,
// which is what xterm's IBufferRange wants.
function findLinks(text: string, cols: number, startRow: number): FoundLink[] {
  const out: FoundLink[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    // Trailing punctuation is almost always the sentence, not the URL.
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (!url) continue;
    const from = m.index;
    const to = from + url.length - 1;
    out.push({
      url,
      href: /^www\./i.test(url) ? `https://${url}` : url,
      startX: (from % cols) + 1,
      startY: startRow + Math.floor(from / cols) + 1,
      endX: (to % cols) + 1,
      endY: startRow + Math.floor(to / cols) + 1,
    });
  }
  return out;
}

// Clickable URLs, without the web-links addon: read the whole wrapped line out
// of the buffer, find URLs in it, and map the character offsets back to
// row/column. Every buffer row is exactly `cols` wide when it is not trimmed,
// which is what makes the mapping a division.
function registerLinks(pane: Pane, term: Terminal) {
  term.registerLinkProvider({
    provideLinks(y, cb) {
      const buf = term.buffer.active;
      const cols = term.cols;

      let start = y - 1;
      while (start > 0 && buf.getLine(start)?.isWrapped) start--;

      let text = '';
      for (let i = start; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (!line) break;
        if (i > start && !line.isWrapped) break;
        text += line.translateToString(false);
      }

      const links = findLinks(text, cols, start)
        // Only the row xterm asked about.
        .filter((l) => y >= l.startY && y <= l.endY)
        .map((l) => ({
          range: { start: { x: l.startX, y: l.startY }, end: { x: l.endX, y: l.endY } },
          text: l.url,
          // A modifier is required on purpose. Clicking a tile to focus it is
          // the most common click there is, and it must never open a browser.
          activate: (ev: MouseEvent) => {
            if (!(ev.metaKey || ev.ctrlKey)) return;
            void window.claufy.openExternal(l.href);
          },
          hover: () => hoveredLink.set(pane.id, l.href),
          leave: () => hoveredLink.delete(pane.id),
        }));
      cb(links.length ? links : undefined);
    },
  });
}

function wireTerminalInput(pane: Pane, term: Terminal, host: HTMLElement) {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;

    // On Windows and Linux, Ctrl+C is interrupt — except when text is
    // selected, when every terminal on those platforms copies instead. The
    // selection is cleared afterwards so the next Ctrl+C interrupts again.
    if (!isMac && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      copyFrom(pane);
      term.clearSelection();
      return false;
    }

    // The older clipboard convention, still muscle memory for a lot of people.
    if (e.key === 'Insert' && e.shiftKey && !e.ctrlKey) { void pasteInto(pane); return false; }
    if (e.key === 'Insert' && e.ctrlKey && !e.shiftKey) { copyFrom(pane); return false; }

    return true;
  });

  registerLinks(pane, term);

  if (isLinux) {
    // X11's primary selection: selecting fills it, middle-click pastes it.
    term.onSelectionChange(() => {
      const text = term.getSelection();
      if (text) window.claufy.clipboardWrite(text, 'selection');
    });
    host.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      void pasteInto(pane, 'selection');
    });
  }

  // Drop a file or folder to type its path, quoted — what dragging onto
  // Terminal.app does. Without this the drop navigated the window to the file
  // and took every running shell with it.
  pane.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  pane.body.addEventListener('drop', (e) => {
    e.preventDefault();
    setActive(pane.id);
    const paths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => window.claufy.filePath(f))
      .filter(Boolean);
    const text = paths.length
      ? paths.map(shellQuote).join(' ') + ' '
      : (e.dataTransfer?.getData('text/plain') ?? '');
    if (text) term.paste(text);
  });
}

async function addTerminal(cwd?: string, command?: string): Promise<Pane> {
  let requestedCwd = cwd;
  if (!requestedCwd) {
    try { requestedCwd = await window.claufy.homedir(); } catch { /* main process unavailable */ }
  }
  const title = cwd ? shortPath(cwd) : 'terminal';
  const pane = makePane('term', title);
  pane.cwd = requestedCwd;

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
    saveWorkspace();
    return pane;
  }

  const host = document.createElement('div');
  host.className = 'term-host';
  pane.body.append(host);

  const term = new Terminal({
    // Font, size and the whole palette are the user's Terminal.app "Clear Dark"
    // profile, so a tile is indistinguishable from the window it replaces.
    fontSize: settings.fontSize,
    fontFamily: '"JetBrainsMono NFP Thin", "JetBrainsMono Nerd Font Propo", "JetBrains Mono", ui-monospace, Menlo, monospace',
    cursorBlink: true,
    allowProposedApi: true,
    // xterm keeps 1000 lines by default, which loses the top of any real build
    // log. Terminal.app's own default is unlimited; 50k is the honest middle.
    scrollback: 50000,
    theme: TERM_THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  pane.term = term;
  pane.fit = fit;
  wireTerminalInput(pane, term, host);

  layout();
  // Let the grid settle before measuring, or the first fit is a wrong size.
  // Raced against a timer on purpose: Chromium stops firing rAF when the
  // window is occluded or minimised, and waiting on it alone means a tile
  // opened while Claufy is behind another window never reaches the spawn below
  // — no shell, no error, just an empty tile that comes back to life only if
  // you happen to bring the window forward.
  await Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    new Promise((r) => setTimeout(r, 250)),
  ]);
  try { fit.fit(); } catch { /* zero-sized while animating */ }

  const res = await window.claufy.spawn({
    id: pane.id,
    cwd: requestedCwd,
    cols: term.cols,
    rows: term.rows,
    command,
  });

  if (!res.ok) {
    spawnErrors.push(res.error ?? 'unknown');
    term.write(`\r\n\x1b[31mCould not start a shell: ${res.error ?? 'unknown'}\x1b[0m\r\n`);
    pane.dead = true;
    pane.el.classList.add('dead');
    saveWorkspace();
    return pane;
  }
  pane.cwd = res.cwd ?? requestedCwd;
  if (res.cwd && requestedCwd && res.cwd !== requestedCwd) {
    pane.title = shortPath(res.cwd) || 'terminal';
    const label = pane.el.querySelector('.pane-title');
    if (label) label.textContent = pane.title;
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
  saveWorkspace();
  return pane;
}

function addPage(url: string): Pane | undefined {
  let target = url.trim();
  if (!target) return undefined;
  if (!/^[a-z]+:\/\//i.test(target)) target = 'https://' + target;

  let host: string;
  try { host = new URL(target).host; } catch { toast('That does not look like a URL.'); return undefined; }

  const pane = makePane('page', host);
  pane.url = target;
  const view = document.createElement('webview') as WebviewTag;
  view.setAttribute('src', target);
  view.setAttribute('allowpopups', 'false');
  const rememberUrl = (event: Event) => {
    // A failed workspace restore removes its partially-created panes before
    // saves resume. Ignore navigation events that arrive after that cleanup.
    if (!panes.includes(pane)) return;
    const next = (event as Event & { url?: unknown }).url;
    if (!validWorkspaceString(next)) return;
    try { new URL(next); } catch { return; }
    pane.url = next;
    saveWorkspace();
  };
  view.addEventListener('did-navigate', rememberUrl);
  view.addEventListener('did-navigate-in-page', rememberUrl);
  pane.body.append(view);
  pane.view = view;
  setActive(pane.id);
  layout();
  saveWorkspace();
  return pane;
}

async function restoreWorkspace(workspace: Workspace) {
  let originalRaw: string | null = null;
  let originalRawRead = false;
  try {
    originalRaw = localStorage.getItem(WORKSPACE_KEY);
    originalRawRead = true;
  } catch { /* private mode */ }

  let restoredSuccessfully = false;
  workspaceSavesPaused++;
  try {
    for (const pane of [...panes]) closePane(pane.id);

    const restored: Pane[] = [];
    for (const tile of workspace.tiles) {
      const pane = tile.kind === 'term'
        ? await addTerminal(tile.cwd)
        : addPage(tile.url);
      if (pane) restored.push(pane);
    }

    // Pane order is the saved list order. Stage slots are derived from it: the
    // focused pane takes slot 0 and every other pane keeps its relative order.
    restored.forEach((pane, index) => { pane.slot = index; });
    const staged = restored[workspace.stageIndex];
    if (staged && workspace.stageIndex !== 0) {
      restored[0].slot = workspace.stageIndex;
      staged.slot = 0;
    }
    activeId = settings.mode === 'stage'
      ? staged?.id ?? restored[0]?.id ?? null
      : restored[workspace.activeIndex]?.id ?? staged?.id ?? restored[0]?.id ?? null;
    layout();
    focusPane(activePane());
    restoredSuccessfully = true;
  } catch (error) {
    // Remove every partially-restored pane while persistence is still paused,
    // then put back the exact record that existed before restoration began.
    for (const pane of [...panes]) {
      try { closePane(pane.id); } catch { /* force removal below */ }
      const index = panes.findIndex((candidate) => candidate.id === pane.id);
      if (index >= 0) {
        panes.splice(index, 1);
        try { pane.el.remove(); } catch { /* already detached */ }
      }
    }
    activeId = null;
    try { normalizeSlots(); layout(); } catch { /* preserve the original error */ }
    if (originalRawRead) {
      try {
        if (originalRaw === null) localStorage.removeItem(WORKSPACE_KEY);
        else localStorage.setItem(WORKSPACE_KEY, originalRaw);
      } catch { /* private mode */ }
    }
    throw error;
  } finally {
    workspaceSavesPaused--;
    if (restoredSuccessfully) saveWorkspace();
  }
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
  saveWorkspace();
}

// --- chrome -------------------------------------------------------------

let toastTimer: number | undefined;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

async function openFolderTerminal() {
  const dir = await window.claufy.pickFolder();
  if (dir) void addTerminal(dir);
}

function openPageDialog() {
  pageUrl.value = '';
  pageDialog.showModal();
  pageUrl.focus();
}

function setMode(mode: Mode) {
  settings.mode = mode;
  modeSel.value = mode;
  sizeWrap.style.visibility = mode === 'grow' ? 'visible' : 'hidden';
  saveSettings();
  stageTheActive();
  layout();
  saveWorkspace();
}

function step(delta: number) {
  if (panes.length < 2) return;
  const i = activeId ? panes.findIndex((p) => p.id === activeId) : -1;
  const next = ((i < 0 ? 0 : i + delta) + panes.length) % panes.length;
  setActive(panes[next].id);
}

function setFontSize(next: number) {
  const size = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(next)));
  if (size === settings.fontSize) return;
  settings.fontSize = size;
  saveSettings();
  for (const p of panes) {
    if (!p.term) continue;
    p.term.options.fontSize = size;
    try {
      p.fit?.fit();
      window.claufy.resize(p.id, p.term.cols, p.term.rows);
    } catch { /* mid-animation zero size */ }
  }
}

document.getElementById('add-term')!.addEventListener('click', () => void addTerminal());
document.getElementById('add-term-dir')!.addEventListener('click', () => void openFolderTerminal());
document.getElementById('add-page')!.addEventListener('click', openPageDialog);

pageDialog.addEventListener('close', () => {
  if (pageDialog.returnValue === 'ok') addPage(pageUrl.value);
});

// The URL field in the Open-a-page dialog is a real text input, and Cmd+C /
// Cmd+V / Cmd+A must act on it while it has focus rather than on the terminal
// behind the dialog. xterm's own hidden textarea is not one of these.
function focusedInput(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  if (el.classList.contains('xterm-helper-textarea')) return null;
  return el;
}

async function pasteIntoInput(input: HTMLInputElement | HTMLTextAreaElement) {
  const text = await window.claufy.clipboardRead();
  if (!text) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
}

// Read by the smoke test, which clicks real menu items and then checks that
// the command arrived here.
const commandsSeen: string[] = [];
(window as unknown as { __claufyCommands: string[] }).__claufyCommands = commandsSeen;

// The menu bar and the right-click menu name a command; the tile you are in
// performs it. Nothing here goes through an Electron `role`, because a role
// would act on the document and a terminal's text is not in the document.
window.claufy.onCommand((cmd) => {
  commandsSeen.push(cmd);
  const input = focusedInput();
  if (input) {
    if (cmd === 'copy') {
      const text = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
      if (text) window.claufy.clipboardWrite(text);
      return;
    }
    if (cmd === 'paste') { void pasteIntoInput(input); return; }
    if (cmd === 'select-all') { input.select(); return; }
  }

  const p = activePane();
  switch (cmd) {
    case 'new-terminal': void addTerminal(); break;
    case 'new-terminal-folder': void openFolderTerminal(); break;
    case 'new-page': openPageDialog(); break;
    case 'close-tile': if (activeId) closePane(activeId); break;
    case 'copy': if (p && !copyFrom(p)) toast('Nothing selected to copy.'); break;
    case 'paste': if (p) void pasteInto(p); break;
    case 'select-all': if (p?.term) p.term.selectAll(); else p?.view?.selectAll(); break;
    case 'clear': p?.term?.clear(); break;
    case 'zoom-tile': toggleSolo(); break;
    case 'next-tile': step(1); break;
    case 'prev-tile': step(-1); break;
    case 'font-bigger': setFontSize(settings.fontSize + 1); break;
    case 'font-smaller': setFontSize(settings.fontSize - 1); break;
    case 'font-reset': setFontSize(DEFAULTS.fontSize); break;
    case 'mode-stage': setMode('stage'); break;
    case 'mode-equal': setMode('equal'); break;
    case 'mode-grow': setMode('grow'); break;
    case 'mode-solo': setMode('solo'); break;
  }
});

// Only the chords the menu cannot own live here. Everything the shell needs —
// every bare Ctrl chord on Windows and Linux — is deliberately left alone.
window.addEventListener(
  'keydown',
  (e) => {
    // While the dialog is up it owns the keyboard, Escape included.
    if (pageDialog.open) return;

    if (e.key === 'Escape' && settings.mode === 'solo') {
      e.preventDefault();
      toggleSolo();
      return;
    }

    // Jump to a tile. Cmd on macOS, where the terminal never sees it; Alt
    // elsewhere, where Ctrl+digit is the shell's.
    const jump = isMac ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey;
    if (jump && e.key >= '1' && e.key <= '9') {
      const target = panes[Number(e.key) - 1];
      if (target) {
        // Capture-phase stopPropagation, or xterm still sends Alt+digit as a
        // meta escape to the shell.
        e.preventDefault();
        e.stopPropagation();
        setActive(target.id);
      }
      return;
    }

    // Cmd+= is what people actually press for "bigger"; the menu owns Cmd+Plus.
    if ((isMac ? e.metaKey : e.ctrlKey) && e.shiftKey === false && e.key === '=') {
      e.preventDefault();
      e.stopPropagation();
      setFontSize(settings.fontSize + 1);
    }
  },
  true,
);

// A drop that lands outside a tile would otherwise navigate the window to the
// dropped file, replacing the app and killing every shell in it.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

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

  // Where the run got to. The main process reads this if the run never
  // returns, so a hang names the step it hung on instead of printing nothing.
  const stage = (name: string) => {
    (window as unknown as { __claufyStage: string }).__claufyStage = name;
  };

  stage('terminals');
  await addTerminal();
  await addTerminal();
  await addTerminal();
  await settle();

  stage('modes');
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

  // Closing the middle tile is the path that can strand the layout: the slots
  // have to close ranks and something has to inherit the centre.
  closePane(panes.find((p) => p.slot === 0)!.id);
  await settle();
  const dense = (n: number) =>
    panes.map((p) => p.slot).sort((a, b) => a - b).join(',') === [...Array(n).keys()].join(',');
  const stageAfterClose = {
    slotsDense: dense(panes.length),
    centreIsActive: panes.find((p) => p.slot === 0)?.id === activeId,
    stillVisible: panes.every((p) => p.el.getBoundingClientRect().width > 0),
  };
  await addTerminal();
  await settle();
  const stageAfterOpen = {
    newTileTookCentre: panes[panes.length - 1].slot === 0,
    slotsDense: dense(panes.length),
  };

  // A page tile pushed onto a rail. A <webview> takes pointer events before the
  // embedder sees them, so the only proof that clicking one promotes it is that
  // the topmost thing at its centre is the click sheet, not the webview.
  // 127.0.0.1:1 refuses instantly and needs no network — the element is what
  // matters here, not what it managed to load.
  addPage('https://127.0.0.1:1');
  await settle();
  setActive(panes.find((p) => p.slot === 1)!.id);
  await new Promise((r) => setTimeout(r, SWAP_MS + 200));
  const pagePane = panes.find((p) => p.kind === 'page');
  const pr = pagePane?.body.getBoundingClientRect();
  const overPage = pr ? document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2) : null;
  const railPage = {
    onARail: (pagePane?.slot ?? 0) > 0,
    topmostIsTheClickSheet: overPage?.classList.contains('pane-catch') ?? false,
    // and the middle tile keeps its page interactive: no sheet over slot 0
    middleHasNoSheet:
      getComputedStyle(panes.find((p) => p.slot === 0)!.body.querySelector('.pane-catch')!).display === 'none',
  };

  settings.mode = 'grow';
  layout();
  // Stage and Grow can have the same number of columns, and then the browser
  // interpolates between the two templates instead of jumping. Measuring
  // without waiting reads a frame mid-transition and calls the active tile
  // smaller than it ends up.
  await settle();

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

  // --- clipboard ---------------------------------------------------------
  // Select what the shell printed, copy it the way the Copy menu item does,
  // and read it back off the real system clipboard. This is the whole point of
  // the parity work: the old menu ran Chromium's Copy, which copied nothing
  // because a terminal's selection is not the document's.
  stage('clipboard');
  const clipBefore = await window.claufy.clipboardRead();
  const target = panes.find((p) => p.term && gotData.has(p.id));
  let copied = '';
  if (target?.term) {
    target.term.selectAll();
    copyFrom(target);
    copied = await window.claufy.clipboardRead();
    target.term.clearSelection();
  }

  stage('paste');
  const PASTE_PROBE = 'claufy-paste-probe';
  window.claufy.clipboardWrite(PASTE_PROBE);
  let pasteLanded = false;
  if (target?.term) {
    await pasteInto(target);
    await settle();
    pasteLanded = paneText(target).includes(PASTE_PROBE);
    window.claufy.write(target.id, '\x15'); // Ctrl+U, clear the typed line
  }
  if (clipBefore) window.claufy.clipboardWrite(clipBefore);

  // --- workspace persistence --------------------------------------------
  // Serialize the real mixed workspace, replace every live pane through the
  // same restore path boot uses, and confirm the Stage occupant and pane order
  // survive. One terminal is deliberately pointed at a missing directory; the
  // main process must fall back to home and return the actual cwd it used.
  const reportActiveId = activeId;
  const reportActiveIsBigger =
    sized.length > 1 && reportActiveId
      ? (() => {
          const active = sized.find((item) => item.id === reportActiveId);
          if (!active) return null; // the optional scope probe opened after sizing
          return sized.filter((item) => item.id !== reportActiveId)
            .every((other) => active.w * active.h >= other.w * other.h);
        })()
      : null;
  stage('workspace');
  settings.mode = 'stage';
  modeSel.value = settings.mode;
  stageTheActive();
  layout();
  const focusTarget = panes.find((pane) => pane.kind === 'page') ?? panes[0];
  if (focusTarget) setActive(focusTarget.id);
  await new Promise((r) => setTimeout(r, SWAP_MS + 200));

  const beforeRestoreReport = {
    panes: panes.length,
    shellsProducedOutput: gotData.size,
    dead: panes.filter((pane) => pane.dead).length,
    titles: panes.map((pane) => pane.title),
  };
  const serialized = serializeWorkspace();
  saveWorkspace();
  const stored = loadWorkspace();
  const malformedRejected = [
    '{',
    JSON.stringify({ ...serialized, version: 2 }),
    JSON.stringify({ ...serialized, stageIndex: serialized.tiles.length + 1 }),
    JSON.stringify({ ...serialized, tiles: [{ kind: 'term', cwd: 42 }] }),
    JSON.stringify({ ...serialized, tiles: [{ kind: 'page', url: 'not a url' }] }),
    JSON.stringify({
      ...serialized,
      tiles: Array.from({ length: MAX_WORKSPACE_TILES + 1 }, () => ({ kind: 'term' })),
      stageIndex: 0,
      activeIndex: 0,
    }),
    JSON.stringify({
      ...serialized,
      tiles: [{ kind: 'term', cwd: 'x'.repeat(MAX_WORKSPACE_VALUE + 1) }],
      stageIndex: 0,
      activeIndex: 0,
    }),
    JSON.stringify({
      ...serialized,
      tiles: [{ kind: 'page', url: `https://example.com/${'x'.repeat(MAX_WORKSPACE_VALUE)}` }],
      stageIndex: 0,
      activeIndex: 0,
    }),
  ].every((raw) => parseWorkspace(raw) === null);
  const emptyAccepted = parseWorkspace(JSON.stringify({
    version: WORKSPACE_VERSION,
    tiles: [],
    stageIndex: -1,
    activeIndex: -1,
  }))?.tiles.length === 0;

  const toRestore = parseWorkspace(JSON.stringify(serialized));
  const termIndex = toRestore?.tiles.findIndex((tile) => tile.kind === 'term') ?? -1;
  const home = await window.claufy.homedir();
  if (toRestore && termIndex >= 0) {
    toRestore.tiles[termIndex] = {
      kind: 'term',
      cwd: isMac || isLinux
        ? `/claufy-smoke-missing-${Date.now()}`
        : `Z:\\claufy-smoke-missing-${Date.now()}`,
    };
  }
  if (toRestore) await restoreWorkspace(toRestore);
  await settle();
  const restored = serializeWorkspace();
  const restoredTerm = termIndex >= 0 ? restored.tiles[termIndex] : undefined;
  const workspacePersistence = {
    serializedVersion: serialized.version,
    serializedKinds: serialized.tiles.map((tile) => tile.kind),
    terminalCwdsPresent: serialized.tiles
      .filter((tile): tile is Extract<WorkspaceTile, { kind: 'term' }> => tile.kind === 'term')
      .every((tile) => typeof tile.cwd === 'string' && tile.cwd.length > 0),
    pageUrlsPresent: serialized.tiles
      .filter((tile): tile is Extract<WorkspaceTile, { kind: 'page' }> => tile.kind === 'page')
      .every((tile) => tile.url.length > 0),
    storageRoundTrip: JSON.stringify(stored) === JSON.stringify(serialized),
    malformedRejected,
    emptyAccepted,
    orderRestored:
      JSON.stringify(restored.tiles.map((tile) => tile.kind)) ===
      JSON.stringify(serialized.tiles.map((tile) => tile.kind)),
    pageUrlsRestored:
      JSON.stringify(restored.tiles.filter((tile) => tile.kind === 'page')) ===
      JSON.stringify(serialized.tiles.filter((tile) => tile.kind === 'page')),
    stageRestored: restored.stageIndex === serialized.stageIndex,
    activeRestored: restored.activeIndex === serialized.activeIndex,
    staleCwdFellBack: restoredTerm?.kind === 'term' && restoredTerm.cwd === home,
  };

  stage('done');
  const fontFamily = '"JetBrainsMono NFP Thin"';
  return {
    copyWorked: copied.trim().length > 0,
    copyOfShellOutput: copied.trim().split('\n').slice(-1)[0]?.slice(0, 60) ?? '',
    pasteWorked: pasteLanded,
    quoting: {
      plain: shellQuote('/tmp/x'),
      spaced: shellQuote('/Users/me/git pop'),
      quoted: shellQuote("/tmp/it's here"),
    },
    // A 20-column line holding a URL that starts mid-row and wraps onto the
    // next one, so the offset-to-row mapping is exercised rather than assumed.
    links: findLinks('see https://ex.co/abc, and www.b.io'.padEnd(40, ' '), 20, 4),
    scopeProbe,
    fontLoaded: document.fonts.check(`12px ${fontFamily}`),
    bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
    bg: getComputedStyle(document.body).backgroundColor,
    ptyOk,
    ptyErr,
    panes: beforeRestoreReport.panes,
    shape,
    templates: seen,
    stageSwap,
    stageAfterClose,
    stageAfterOpen,
    railPage,
    workspacePersistence,
    shellsProducedOutput: beforeRestoreReport.shellsProducedOutput,
    spawnErrors,
    dead: beforeRestoreReport.dead,
    titles: beforeRestoreReport.titles,
    rects: sized,
    activeIsBigger: reportActiveIsBigger,
  };
};

// --- boot ---------------------------------------------------------------

(async () => {
  const workspace = loadWorkspace();
  const status = await window.claufy.ptyAvailable();
  ptyOk = status.ok;
  ptyErr = status.error;
  layout();
  if (!ptyOk) toast('Terminals unavailable — run npm run rebuild');
  if (workspace) await restoreWorkspace(workspace);
  else if (ptyOk) await addTerminal();
})();
