// node-pty ships its macOS/Linux prebuilds with `spawn-helper` missing the
// execute bit, and every attempt to open a shell then fails with the very
// unhelpful "posix_spawnp failed." Restore the bit after install.
//
// Windows has no spawn-helper, so this is a no-op there.

import { chmod, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prebuilds = path.join(root, 'node_modules', 'node-pty', 'prebuilds');

if (!existsSync(prebuilds)) process.exit(0);

let fixed = 0;
for (const dir of await readdir(prebuilds)) {
  const helper = path.join(prebuilds, dir, 'spawn-helper');
  if (!existsSync(helper)) continue;
  const mode = (await stat(helper)).mode;
  if (mode & 0o111) continue; // already executable
  await chmod(helper, 0o755);
  fixed++;
  console.log(`[claufy] made ${path.relative(root, helper)} executable`);
}

if (fixed === 0) console.log('[claufy] spawn-helper permissions already fine');
