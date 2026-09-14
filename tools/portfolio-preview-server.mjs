// Temporary local preview server for the portfolio showcase (not part of the product).
// Serves portfolio/ on a fixed port so the user can open the site locally.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'portfolio');
const DEFAULT_PORT = 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < port + 10) listen(port + 1);
    else { console.error(err.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`portfolio preview: http://localhost:${port}/`));
}

listen(DEFAULT_PORT);
