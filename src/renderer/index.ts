// Claufy renderer. Owns the tiles and the layout; shells live in the main
// process behind the `claufy` bridge.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type Mode = 'equal' | 'grow' | 'solo';

type Pane = {
  id: string;
  kind: 'term' | 'page';
  title: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
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

// --- settings -----------------------------------------------------------

type Settings = { mode: Mode; ratio: number };
const DEFAULTS: Settings = { mode: 'grow', ratio: 2.2 };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('claufy:settings');
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const mode: Mode = s.mode === 'equal' || s.mode === 'grow' || s.mode === 'solo' ? s.mode : DEFAULTS.mode;
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

function layout() {
  const n = panes.length;
  empty.classList.toggle('show', n === 0);
  if (n === 0) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows = '1fr';
    return;
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
  if (activeId === id) return;
  activeId = id;
  layout();
  const p = panes.find((x) => x.id === id);
  p?.term?.focus();
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

  const pane: Pane = { id: `p${++seq}`, kind, title, el, body };

  el.addEventListener('mousedown', () => setActive(pane.id));
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
  if (activeId === id) activeId = panes.length ? panes[Math.min(i, panes.length - 1)].id : null;
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
    fontSize: 12.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    cursorBlink: true,
    allowProposedApi: true,
    theme: {
      background: '#1d1a27',
      foreground: '#e9e6f5',
      cursor: '#7c5cff',
      selectionBackground: '#3a3160',
    },
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
    settings.mode = modeBeforeSolo ?? 'grow';
    modeBeforeSolo = null;
  } else {
    modeBeforeSolo = settings.mode;
    settings.mode = 'solo';
  }
  modeSel.value = settings.mode;
  sizeWrap.style.visibility = settings.mode === 'grow' ? 'visible' : 'hidden';
  saveSettings();
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

  for (const m of ['equal', 'grow', 'solo'] as Mode[]) {
    settings.mode = m;
    layout();
    await settle();
    seen[m] = {
      cols: grid.style.gridTemplateColumns,
      rows: grid.style.gridTemplateRows,
    };
  }

  settings.mode = 'grow';
  layout();

  const sized = panes.map((p) => {
    const r = p.el.getBoundingClientRect();
    return { id: p.id, w: Math.round(r.width), h: Math.round(r.height) };
  });

  return {
    ptyOk,
    ptyErr,
    panes: panes.length,
    shape,
    templates: seen,
    shellsProducedOutput: gotData.size,
    spawnErrors,
    dead: panes.filter((p) => p.dead).length,
    titles: panes.map((p) => p.title),
    rects: sized,
    activeIsBigger:
      sized.length > 1 && activeId
        ? (() => {
            const a = sized.find((s) => s.id === activeId)!;
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
