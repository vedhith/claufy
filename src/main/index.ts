// Claufy main process.
//
// Owns the app window and the pseudo-terminals. The renderer draws tiles and
// decides the layout; it never touches a shell directly. Every pty is keyed by
// the pane id the renderer made up, so the two sides only ever exchange ids.

import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
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
        const report = await win!.webContents.executeJavaScript('window.__claufySmoke()');
        console.log('SMOKE ' + JSON.stringify(report));
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
