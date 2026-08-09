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
let win: BrowserWindow | null = null;

const isWindows = process.platform === 'win32';

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
    backgroundColor: '#14121a',
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
      try {
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

    try {
      const p = ptyModule.spawn(shellPath, args, {
        name: 'xterm-256color',
        cols: Math.max(2, cols | 0),
        rows: Math.max(2, rows | 0),
        cwd: dir,
        env: { ...process.env, TERM: 'xterm-256color', CLAUFY: '1' } as Record<string, string>,
      }) as unknown as Pty;

      p.onData((data) => win?.webContents.send('pty:data', { id, data }));
      p.onExit(({ exitCode }) => {
        ptys.delete(id);
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
