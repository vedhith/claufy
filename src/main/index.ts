// Claufy main process.
//
// Owns the app window and the pseudo-terminals. The renderer draws tiles and
// decides the layout; it never touches a shell directly. Every pty is keyed by
// the pane id the renderer made up, so the two sides only ever exchange ids.

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  Menu,
  clipboard,
  type MenuItemConstructorOptions,
} from 'electron';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// node-pty is a native module, so it is required lazily: a broken build should
// surface as "terminals unavailable" rather than a window that never opens.
type Pty = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  pid: number;
};

let ptyModule: typeof import('node-pty') | null = null;
let ptyLoadError: string | null = null;

function loadPty() {
  if (ptyModule || ptyLoadError) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require('node-pty');
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err);
  }
}

const ptys = new Map<string, Pty>();
const shimDirs = new Map<string, string>();
let win: BrowserWindow | null = null;

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// --- per-tile scoping ---------------------------------------------------

// Claude Code's agent view is machine-wide: every session in every folder,
// with no setting to narrow it. `claude agents --cwd <dir>` does narrow it, so
// each tile gets a tiny `claude` earlier on its PATH that supplies --cwd for
// that tile's folder. Typing `claude agents` in a tile then shows only that
// folder, without the user having to remember a flag.
//
// Everything other than `agents` is passed straight through, so this is not a
// wrapper around Claude Code — it is a default argument for one subcommand.

let realClaude: string | null | undefined;

function findClaude(): string | null {
  if (realClaude !== undefined) return realClaude;
  realClaude = null;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, isWindows ? 'claude.exe' : 'claude');
    try {
      if (fs.statSync(candidate).isFile()) { realClaude = candidate; break; }
    } catch { /* not here */ }
  }
  return realClaude;
}

// A PATH shim is not enough on a login shell: a user's rc commonly prepends
// its own bin directory, and a `claude` *function* in an rc beats any binary
// on PATH regardless of order. For zsh we therefore point ZDOTDIR at a
// generated rc that sources the real one first, then wraps whatever `claude`
// ended up defined — function or binary — so the user's own setup still runs.
// The folder is not baked in: the generated rc reads CLAUFY_DIR, which is set
// per tile in the env below.
function makeScope(id: string): Record<string, string> | null {
  if (isWindows) return null;

  const base = path.join(app.getPath('userData'), 'scope', id);
  const shellPath = defaultShell();
  const isZsh = /(^|\/)zsh$/.test(shellPath);

  try {
    fs.mkdirSync(base, { recursive: true });
    shimDirs.set(id, base);

    if (isZsh) {
      // zsh reads .zshenv/.zprofile/.zshrc from ZDOTDIR, so each must hand off
      // to the user's real file before we add anything.
      const passthrough = (name: string) =>
        `[ -f "$HOME/${name}" ] && source "$HOME/${name}"\n`;

      fs.writeFileSync(path.join(base, '.zshenv'), passthrough('.zshenv'));
      fs.writeFileSync(path.join(base, '.zprofile'), passthrough('.zprofile'));
      fs.writeFileSync(
        path.join(base, '.zshrc'),
        passthrough('.zshrc') +
          `
# --- Claufy: scope this tile's agent view to its own folder ---------------
# Keeps whatever the user's own claude() did; only 'claude agents' changes.
if (( $+functions[claude] )); then
  functions[_claufy_prev_claude]=$functions[claude]
fi
claude() {
  if [[ "$1" == "agents" ]]; then
    shift
    local a
    for a in "$@"; do
      if [[ "$a" == "--cwd" || "$a" == --cwd=* ]]; then
        command claude agents "$@"
        return
      fi
    done
    command claude agents --cwd "\${CLAUFY_DIR:-$PWD}" "$@"
    return
  fi
  if (( $+functions[_claufy_prev_claude] )); then
    _claufy_prev_claude "$@"
  else
    command claude "$@"
  fi
}
`,
      );
      // ZDOTDIR only matters for interactive zsh, which is what a tile is.
      return { ZDOTDIR: base };
    }

    // Non-zsh: fall back to a PATH shim. Works unless the user's rc prepends
    // a directory that also contains claude.
    const claude = findClaude();
    if (!claude) return null;
    const file = path.join(base, 'claude');
    fs.writeFileSync(
      file,
      `#!/bin/sh
# Written by Claufy. Scopes this tile's agent view to its own folder.
REAL=${JSON.stringify(claude)}
if [ "$1" = "agents" ]; then
  shift
  for a in "$@"; do
    case "$a" in
      --cwd|--cwd=*) exec "$REAL" agents "$@" ;;
    esac
  done
  exec "$REAL" agents --cwd "\${CLAUFY_DIR:-$PWD}" "$@"
fi
exec "$REAL" "$@"
`,
      { mode: 0o755 },
    );
    fs.chmodSync(file, 0o755);
    return { PATH: `${base}${path.delimiter}${process.env.PATH ?? ''}` };
  } catch {
    return null;
  }
}

function dropShim(id: string) {
  const dir = shimDirs.get(id);
  if (!dir) return;
  shimDirs.delete(id);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
}

function defaultShell(): string {
  if (isWindows) return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

// --- menus --------------------------------------------------------------

// Every editing command is a message to the renderer, never an Electron
// `role`. A role runs Chromium's own Copy, which copies the *document*
// selection — and a terminal's selection is xterm's, drawn by xterm, invisible
// to the document. Roles are why copy silently did nothing.
function send(cmd: string) {
  win?.webContents.send('app:command', cmd);
}

function item(label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, click: () => send(cmd) };
}

// Which keys an app may take differs completely between the two worlds, and
// getting it wrong is worse than having no menu at all.
//
// On macOS the terminal never sees Cmd, so Cmd+C/V/A/K are free and are what
// Terminal.app itself uses.
//
// On Windows and Linux every bare Ctrl chord belongs to the shell: Ctrl+C is
// interrupt, Ctrl+R is history search, Ctrl+Z suspends, Ctrl+A goes to the
// start of the line, Ctrl+W kills a word. Electron's *default* menu binds
// Copy/Paste/Select All/Reload to exactly those, which is why a shell in a
// tile could not be interrupted and Ctrl+R reloaded the whole app. So the app
// takes Ctrl+Shift instead, the same convention as GNOME Terminal and Windows
// Terminal, and leaves every bare Ctrl chord to the pty.
const K = {
  newTerm: isMac ? 'Cmd+T' : 'Ctrl+Shift+T',
  newFolder: isMac ? 'Cmd+Shift+T' : 'Ctrl+Shift+O',
  closeTile: isMac ? 'Cmd+W' : 'Ctrl+Shift+W',
  closeWindow: isMac ? 'Cmd+Shift+W' : 'Ctrl+Shift+Q',
  copy: isMac ? 'Cmd+C' : 'Ctrl+Shift+C',
  paste: isMac ? 'Cmd+V' : 'Ctrl+Shift+V',
  selectAll: isMac ? 'Cmd+A' : 'Ctrl+Shift+A',
  clear: isMac ? 'Cmd+K' : 'Ctrl+Shift+K',
  zoom: 'CommandOrControl+Return',
  bigger: 'CommandOrControl+Plus',
  smaller: 'CommandOrControl+-',
  resetText: 'CommandOrControl+0',
  reload: isMac ? 'Cmd+Alt+R' : 'Ctrl+Shift+R',
  devtools: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
};

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [];

  // Spelled out rather than `role: 'appMenu'`, which binds Quit and Hide to
  // CommandOrControl — correct on macOS, but it would read as Ctrl+Q and
  // Ctrl+H on the other two, and both of those belong to the shell. Writing
  // Cmd explicitly keeps the audit below able to tell the difference.
  if (isMac) {
    template.push({
      label: 'Claufy',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', accelerator: 'Cmd+H' },
        { role: 'hideOthers', accelerator: 'Cmd+Alt+H' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', accelerator: 'Cmd+Q' },
      ],
    });
  }

  template.push({
    label: isMac ? 'Shell' : 'File',
    submenu: [
      item('New Terminal', 'new-terminal', K.newTerm),
      item('New Terminal in Folder…', 'new-terminal-folder', K.newFolder),
      item('New Web Page…', 'new-page'),
      { type: 'separator' },
      item('Close Tile', 'close-tile', K.closeTile),
      isMac
        ? { role: 'close', label: 'Close Window', accelerator: K.closeWindow }
        : { role: 'quit', label: 'Quit', accelerator: K.closeWindow },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      item('Copy', 'copy', K.copy),
      item('Paste', 'paste', K.paste),
      item('Select All', 'select-all', K.selectAll),
      { type: 'separator' },
      item('Clear', 'clear', K.clear),
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      item('Stage', 'mode-stage'),
      item('Equal', 'mode-equal'),
      item('Grow', 'mode-grow'),
      item('Solo', 'mode-solo'),
      { type: 'separator' },
      item('Zoom Tile', 'zoom-tile', K.zoom),
      item('Next Tile', 'next-tile', isMac ? 'Cmd+Alt+Right' : 'Ctrl+Alt+Right'),
      item('Previous Tile', 'prev-tile', isMac ? 'Cmd+Alt+Left' : 'Ctrl+Alt+Left'),
      { type: 'separator' },
      item('Bigger Text', 'font-bigger', K.bigger),
      item('Smaller Text', 'font-smaller', K.smaller),
      item('Default Text Size', 'font-reset', K.resetText),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      // Deliberately not Cmd/Ctrl+R: that is history search in every shell.
      { role: 'forceReload', label: 'Reload Claufy', accelerator: K.reload },
      { role: 'toggleDevTools', accelerator: K.devtools },
    ],
  });

  if (isMac) {
    template.push({
      label: 'Window',
      submenu: [
        { role: 'minimize', accelerator: 'Cmd+M' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    });
  }

  template.push({
    role: 'help',
    submenu: [
      {
        label: 'Claufy on the web',
        click: () => void shell.openExternal('https://claufy.pages.dev'),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}

// Part of CLAUFY_SMOKE. The renderer's own checks call copy and paste
// directly, which proves the clipboard works but not that a keystroke reaches
// it. This clicks the real menu items and reads back what the renderer
// received, and lists every accelerator so the chords the shell needs can be
// seen to be free.
async function checkMenu() {
  const menu = Menu.getApplicationMenu();
  if (!menu || !win) return { built: false };

  const bindings: { label: string; accelerator: string }[] = [];
  const walk = (items: Electron.MenuItem[]) => {
    for (const it of items) {
      if (it.accelerator) bindings.push({ label: it.label, accelerator: it.accelerator });
      if (it.submenu) walk(it.submenu.items);
    }
  };
  walk(menu.items);

  const click = (menuLabel: string, itemLabel: string) => {
    const top = menu.items.find((i) => i.label === menuLabel);
    const found = top?.submenu?.items.find((i) => i.label === itemLabel);
    if (!found) return false;
    found.click();
    return true;
  };

  const clicked = {
    copy: click('Edit', 'Copy'),
    paste: click('Edit', 'Paste'),
    newTerminal: click(isMac ? 'Shell' : 'File', 'New Terminal'),
    stage: click('View', 'Stage'),
  };

  await new Promise((r) => setTimeout(r, 500));
  const received: string[] = await win.webContents.executeJavaScript('window.__claufyCommands');

  // Ctrl+R is history search, Ctrl+C is interrupt, Ctrl+A is start-of-line.
  // Electron's default menu binds all three; ours must bind none of them. Only
  // letters are checked: Ctrl+0 and Ctrl+- are the text-size bindings every
  // terminal emulator uses and no shell wants.
  const stolenFromShell = bindings.filter((b) => /^(Ctrl|CommandOrControl)\+[A-Za-z]$/.test(b.accelerator));

  return { built: true, clicked, received, stolenFromShell, bindings };
}

function createWindow() {
  const iconPng = path.join(__dirname, '..', 'assets', 'icon.png');
  const icon = fs.existsSync(iconPng) ? nativeImage.createFromPath(iconPng) : undefined;

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#191d27', // Clear Dark BackgroundColor
    title: 'Claufy',
    icon,
    // Keep the traffic lights but drop the title bar: the tiles are the UI.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // webview hosts the "page" tiles. Without this the tag is inert.
      webviewTag: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Dropping a file on a tile should type its path, not replace the whole app
  // with that file — which is what a window-level drop does by default, and it
  // takes every running shell with it.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // CLAUFY_SMOKE=1 boots the app, exercises the real layout code, prints a
  // report and exits. Lets the whole stack be checked without a human at the
  // screen, and fails loudly if the renderer throws on startup.
  if (process.env.CLAUFY_SMOKE) {
    const errors: string[] = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) errors.push(message);
    });
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      win!.webContents.setAudioMuted(true);
      try {
        await win!.webContents.executeJavaScript(
          'window.__claufyProbeDir=' + JSON.stringify(process.env.CLAUFY_PROBE_DIR ?? ''),
        );
        // Raced against a timeout so a stuck step reports which step, rather
        // than leaving a windowless app running for as long as anyone waits.
        const report = await Promise.race([
          win!.webContents.executeJavaScript('window.__claufySmoke()'),
          new Promise((r) => setTimeout(() => r({ timedOut: true }), 60_000)),
        ]);
        const stage = await win!.webContents.executeJavaScript('window.__claufyStage');
        console.log('SMOKE STAGE ' + stage);
        console.log('SMOKE ' + JSON.stringify(report));
        console.log('SMOKE MENU ' + JSON.stringify(await checkMenu()));
      } catch (err) {
        console.log('SMOKE ERROR ' + (err instanceof Error ? err.message : String(err)));
      }
      if (errors.length) console.log('SMOKE CONSOLE_ERRORS ' + JSON.stringify(errors.slice(0, 8)));
      app.exit(0);
    });
  }

  win.on('closed', () => {
    for (const p of ptys.values()) {
      try { p.kill(); } catch { /* already gone */ }
    }
    ptys.clear();
    for (const id of [...shimDirs.keys()]) dropShim(id);
    win = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const iconPng = path.join(__dirname, '..', 'assets', 'icon.png');
    if (fs.existsSync(iconPng)) {
      try { app.dock?.setIcon(nativeImage.createFromPath(iconPng)); } catch { /* dev only */ }
    }
  }
  Menu.setApplicationMenu(buildMenu());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- terminals ----------------------------------------------------------

ipcMain.handle('pty:available', () => {
  loadPty();
  return { ok: ptyModule !== null, error: ptyLoadError };
});

ipcMain.handle(
  'pty:spawn',
  (_e, { id, cwd, cols, rows, command }: { id: string; cwd?: string; cols: number; rows: number; command?: string }) => {
    loadPty();
    if (!ptyModule) return { ok: false, error: ptyLoadError ?? 'node-pty unavailable' };
    if (ptys.has(id)) return { ok: true };

    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const shellPath = defaultShell();
    // A login shell so the user's aliases and PATH are present, matching what
    // they would get from a real terminal window.
    const args = isWindows ? [] : ['-l'];

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      CLAUFY: '1',
      // The tile's folder, so anything running inside can scope itself too.
      CLAUFY_DIR: dir,
      ...(makeScope(id) ?? {}),
    };

    try {
      const p = ptyModule.spawn(shellPath, args, {
        name: 'xterm-256color',
        cols: Math.max(2, cols | 0),
        rows: Math.max(2, rows | 0),
        cwd: dir,
        env,
      }) as unknown as Pty;

      p.onData((data) => win?.webContents.send('pty:data', { id, data }));
      p.onExit(({ exitCode }) => {
        ptys.delete(id);
        dropShim(id);
        win?.webContents.send('pty:exit', { id, exitCode });
      });

      ptys.set(id, p);

      if (command && command.trim()) {
        // Give the shell a moment to print its prompt before typing into it.
        setTimeout(() => {
          try { p.write(command + '\r'); } catch { /* pane closed */ }
        }, 350);
      }
      return { ok: true, pid: p.pid };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.on('pty:write', (_e, { id, data }: { id: string; data: string }) => {
  const p = ptys.get(id);
  if (p) { try { p.write(data); } catch { /* closing */ } }
});

ipcMain.on('pty:resize', (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
  const p = ptys.get(id);
  if (!p) return;
  try { p.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)); } catch { /* closing */ }
});

ipcMain.on('pty:kill', (_e, { id }: { id: string }) => {
  const p = ptys.get(id);
  if (!p) return;
  try { p.kill(); } catch { /* already gone */ }
  ptys.delete(id);
  dropShim(id);
});

// --- clipboard ----------------------------------------------------------

// 'selection' is X11's primary selection — the one middle-click pastes. It
// only exists on Linux; asking for it anywhere else returns the normal
// clipboard, which would silently paste the wrong thing.
const isLinux = process.platform === 'linux';

ipcMain.handle('clipboard:read', (_e, which?: 'clipboard' | 'selection') =>
  which === 'selection' && isLinux ? clipboard.readText('selection') : clipboard.readText(),
);

ipcMain.on('clipboard:write', (_e, { text, which }: { text: string; which?: 'clipboard' | 'selection' }) => {
  if (typeof text !== 'string' || !text) return;
  if (which === 'selection') {
    if (isLinux) clipboard.writeText(text, 'selection');
    return;
  }
  clipboard.writeText(text);
});

// Right-click. Terminal.app has this menu and people reach for it, so it is a
// real native one rather than a div that would not match the OS.
ipcMain.on('menu:context', (_e, info: { hasSelection: boolean; kind: 'term' | 'page'; link?: string }) => {
  if (!win) return;
  const items: MenuItemConstructorOptions[] = [];

  if (info.link) {
    items.push(
      { label: 'Open Link', click: () => void shell.openExternal(info.link!) },
      { label: 'Copy Link', click: () => clipboard.writeText(info.link!) },
      { type: 'separator' },
    );
  }

  items.push(
    { label: 'Copy', accelerator: K.copy, enabled: info.hasSelection, click: () => send('copy') },
    { label: 'Paste', accelerator: K.paste, enabled: clipboard.readText().length > 0, click: () => send('paste') },
    { label: 'Select All', accelerator: K.selectAll, click: () => send('select-all') },
  );

  if (info.kind === 'term') {
    items.push({ type: 'separator' }, { label: 'Clear', accelerator: K.clear, click: () => send('clear') });
  }

  items.push(
    { type: 'separator' },
    { label: 'New Terminal', accelerator: K.newTerm, click: () => send('new-terminal') },
    { label: 'Close Tile', accelerator: K.closeTile, click: () => send('close-tile') },
  );

  Menu.buildFromTemplate(items).popup({ window: win });
});

// --- misc ---------------------------------------------------------------

ipcMain.handle('dialog:pickFolder', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('app:homedir', () => os.homedir());

// Native apps cannot be embedded in a window cross-platform, so "open an app"
// hands off to the OS instead of pretending to host it.
ipcMain.handle('app:openExternal', async (_e, target: string) => {
  try {
    if (/^https?:\/\//i.test(target)) await shell.openExternal(target);
    else await shell.openPath(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
