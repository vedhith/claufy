// The only bridge between the tiles and the shells. Everything the renderer
// can do to a pty is listed here, so a compromised page cannot reach further.

import { contextBridge, ipcRenderer } from 'electron';

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
  platform: process.platform,
});
