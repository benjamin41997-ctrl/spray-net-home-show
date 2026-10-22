import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' };

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.'); return;
    }
    const url = new URL(request.url, 'http://localhost:4173');
    // This server serves static files only. A missing API must never appear to save a lead.
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        error: 'Live lead capture and rendering are not connected to this preview.' })); return;
    }
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
      response.writeHead(403).end('Forbidden.'); return;
    }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400)
      .end(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'File not found.' : 'Invalid request.');
  }
}).listen(4173, '127.0.0.1', () => console.log('Preview: http://localhost:4173 (static preview; backend configured separately)'));
