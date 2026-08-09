// The only bridge between the tiles and the shells. Everything the renderer
// can do to a pty is listed here, so a compromised page cannot reach further.

import { contextBridge, ipcRenderer, webUtils } from 'electron';

type Spawn = { id: string; cwd?: string; cols: number; rows: number; command?: string };

const dataSubs = new Map<string, (data: string) => void>();
const exitSubs = new Map<string, (code: number) => void>();

ipcRenderer.on('pty:data', (_e, { id, data }: { id: string; data: string }) => {
  dataSubs.get(id)?.(data);
});

ipcRenderer.on('pty:exit', (_e, { id, exitCode }: { id: string; exitCode: number }) => {
  exitSubs.get(id)?.(exitCode);
  dataSubs.delete(id);
  exitSubs.delete(id);
});

// Menu items and the right-click menu do not act on the DOM — a terminal's
// selection is xterm's, not the document's — so they name a command and the
// renderer performs it on whichever tile is active.
let commandSub: ((cmd: string) => void) | null = null;
ipcRenderer.on('app:command', (_e, cmd: string) => commandSub?.(cmd));

contextBridge.exposeInMainWorld('claufy', {
  ptyAvailable: () => ipcRenderer.invoke('pty:available'),
  spawn: (opts: Spawn) => ipcRenderer.invoke('pty:spawn', opts),
  write: (id: string, data: string) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id: string) => ipcRenderer.send('pty:kill', { id }),
  onData: (id: string, cb: (data: string) => void) => { dataSubs.set(id, cb); },
  onExit: (id: string, cb: (code: number) => void) => { exitSubs.set(id, cb); },
  offPane: (id: string) => { dataSubs.delete(id); exitSubs.delete(id); },
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  homedir: () => ipcRenderer.invoke('app:homedir'),
  openExternal: (target: string) => ipcRenderer.invoke('app:openExternal', target),

  // Clipboard goes through the main process rather than navigator.clipboard:
  // the async read needs a permission and a user gesture, and neither is
  // reliable from a menu accelerator. Electron's clipboard is synchronous and
  // always available, and it is the only way to reach the X11 primary
  // selection that middle-click paste uses.
  clipboardRead: (which?: 'clipboard' | 'selection') => ipcRenderer.invoke('clipboard:read', which),
  clipboardWrite: (text: string, which?: 'clipboard' | 'selection') =>
    ipcRenderer.send('clipboard:write', { text, which }),

  contextMenu: (info: { hasSelection: boolean; kind: 'term' | 'page'; link?: string }) =>
    ipcRenderer.send('menu:context', info),

  onCommand: (cb: (cmd: string) => void) => { commandSub = cb; },

  // File.path was removed from Electron's renderer, so the path of a dropped
  // file can only be had here.
  filePath: (f: File) => {
    try { return webUtils.getPathForFile(f); } catch { return ''; }
  },
  platform: process.platform,
});
