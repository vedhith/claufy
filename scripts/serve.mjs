// Dev server: the landing page at /, the icon prototypes at /prototypes/.
// Tries port 400 first because that is what was asked for; ports under 1024
// need root, so it falls back rather than dying.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = [400, 4000, 4001];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  let url = (req.url ?? '/').split('?')[0];
  if (url === '/') url = '/site/index.html';
  else if (url === '/prototypes' || url === '/prototypes/') url = '/prototypes/icons.html';
  else if (url === '/prototypes/next' || url === '/next') url = '/prototypes/next.html';
  else if (!url.startsWith('/prototypes/') && !url.startsWith('/site/')) url = '/site' + url;

  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403).end('no'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

function listen(i) {
  if (i >= PORTS.length) { console.error('No free port.'); process.exit(1); }
  server.once('error', (e) => {
    console.log(`port ${PORTS[i]}: ${e.code === 'EACCES' ? 'needs root' : e.code} — next`);
    listen(i + 1);
  });
  server.listen(PORTS[i], () => console.log(`READY http://localhost:${PORTS[i]}/`));
}
listen(0);
