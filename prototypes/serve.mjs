// Serves the icon prototypes. Tries port 400 first because that is what was
// asked for; ports under 1024 need root, so it falls back rather than dying.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORTS = [400, 4000, 4001];

const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const rel = url === '/' ? 'icons.html' : url.replace(/^\/+/, '');
  const file = path.join(here, rel);
  // Never serve outside the prototypes folder.
  if (!file.startsWith(here)) { res.writeHead(403).end('no'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

function listen(i) {
  if (i >= PORTS.length) {
    console.error('No free port found.');
    process.exit(1);
  }
  server.once('error', (err) => {
    const why = err.code === 'EACCES' ? 'needs root' : err.code === 'EADDRINUSE' ? 'in use' : err.code;
    console.log(`port ${PORTS[i]}: ${why} — trying next`);
    listen(i + 1);
  });
  server.listen(PORTS[i], () => console.log(`READY http://localhost:${PORTS[i]}/`));
}

listen(0);
