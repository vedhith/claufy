// Three bundles: main (node), preload (node), renderer (browser). Static files
// are copied rather than imported so the HTML stays readable.

import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const rdist = path.join(dist, 'renderer');
const watch = process.argv.includes('--watch');

await mkdir(rdist, { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

const targets = [
  {
    ...common,
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(dist, 'main.js'),
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Electron supplies these at runtime; node-pty is a native build.
    external: ['electron', 'node-pty'],
  },
  {
    ...common,
    entryPoints: [path.join(root, 'src/main/preload.ts')],
    outfile: path.join(dist, 'preload.js'),
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: [path.join(root, 'src/renderer/index.ts')],
    outfile: path.join(rdist, 'renderer.js'),
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
  },
];

async function copyStatic() {
  await copyFile(path.join(root, 'src/renderer/index.html'), path.join(rdist, 'index.html'));
  await copyFile(path.join(root, 'src/renderer/styles.css'), path.join(rdist, 'styles.css'));

  const xterm = path.join(root, 'node_modules/@xterm/xterm/css/xterm.css');
  if (existsSync(xterm)) {
    await copyFile(xterm, path.join(rdist, 'xterm.css'));
  } else {
    // Missing stylesheet only breaks cursor/selection painting, so warn loudly
    // but still produce a runnable build.
    console.warn('[build] @xterm/xterm/css/xterm.css not found — terminals will look wrong');
    await writeFile(path.join(rdist, 'xterm.css'), '/* xterm.css missing at build time */\n');
  }
}

await copyStatic();

if (watch) {
  for (const t of targets) {
    const ctx = await esbuild.context(t);
    await ctx.watch();
  }
  console.log('[build] watching…');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log('[build] done');
}
