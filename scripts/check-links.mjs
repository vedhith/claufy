// Every download link on the landing page, actually fetched.
//
// This exists because of a real bug: electron-builder writes the AppImage as
// Claufy-linux-x86_64.AppImage while every other target says x64, so the Linux
// button on the site pointed at a 404 that nothing else would have caught.
// The names are guesses until something requests them.
//
//   node scripts/check-links.mjs        (npm run check-links)

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');

// Pull the URLs out of the page rather than restating them here — a checker
// with its own copy of the list checks nothing.
const urls = [...new Set(html.match(/https:\/\/github\.com\/[^\s'"<>)]+/g) ?? [])];
if (!urls.length) {
  console.error('no github URLs found in site/index.html — did the page change shape?');
  process.exit(1);
}

// The page builds release URLs by concatenation, so reconstruct those too.
const base = html.match(/const DL = REPO \+ '([^']+)'/)?.[1];
const repo = html.match(/const REPO = '([^']+)'/)?.[1];
if (repo && base) {
  for (const m of html.matchAll(/DL \+ '([^']+)'/g)) urls.push(repo + base + m[1]);
  for (const m of html.matchAll(/\$\{DL\}([A-Za-z0-9._-]+)/g)) urls.push(repo + base + m[1]);
}

let bad = 0;
for (const url of [...new Set(urls)]) {
  let status;
  try {
    // redirect: 'follow' matters — release assets bounce to a CDN host
    status = (await fetch(url, { method: 'HEAD', redirect: 'follow' })).status;
  } catch (e) {
    status = 'ERR ' + e.message;
  }
  const ok = status === 200;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(status).padEnd(6)} ${url}`);
}

console.log(bad ? `\n${bad} broken link(s)` : `\nall ${new Set(urls).size} links resolve`);
process.exit(bad ? 1 : 0);
