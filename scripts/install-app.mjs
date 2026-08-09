// Put the built app where Spotlight will index it, so typing "claufy" in
// Finder or Spotlight brings it up.
//
// ~/Applications, not /Applications: Spotlight indexes both, but the user one
// needs no admin password. Pass --system to use /Applications instead.

import { readdir, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin') {
  console.error('install-app is macOS-only. On Windows/Linux use the installer from `npm run dist`.');
  process.exit(1);
}

const release = path.join(root, 'release');
if (!existsSync(release)) {
  console.error('No release/ directory — run `npm run dist` first.');
  process.exit(1);
}

// electron-builder names the folder by arch (mac-arm64, mac, mac-x64...).
async function findApp(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if (entry.endsWith('.app')) return full;
    const s = await stat(full).catch(() => null);
    if (s?.isDirectory()) {
      const found = await findApp(full);
      if (found) return found;
    }
  }
  return null;
}

const built = await findApp(release);
if (!built) {
  console.error('No .app found under release/ — run `npm run dist` first.');
  process.exit(1);
}

const system = process.argv.includes('--system');
const dir = system ? '/Applications' : path.join(os.homedir(), 'Applications');
await mkdir(dir, { recursive: true });
const dest = path.join(dir, path.basename(built));

// Replace rather than merge: a stale file from an older build inside a bundle
// is the kind of thing that fails only at runtime.
await rm(dest, { recursive: true, force: true });
await run('cp', ['-R', built, dest]);

// electron-builder leaves an unsigned bundle whose signature block still
// claims resources, so `spctl` reports it as broken rather than merely
// unsigned. An ad-hoc signature costs nothing and makes it a clean local app.
await run('codesign', ['--force', '--deep', '--sign', '-', dest]).catch((err) => {
  console.warn('[claufy] ad-hoc signing failed, app should still run:', err.message);
});

// Nudge Spotlight instead of waiting for it to notice on its own.
await run('mdimport', [dest]).catch(() => {});

console.log(`Installed ${path.basename(dest)} to ${dir}`);
console.log('Type "claufy" in Spotlight or Finder to open it.');
