import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { attachMatchmaking } from './matchmaking-core.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 8000);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

const server = createServer(async (request, response) => {
  let requestedPath;
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const filePath = resolve(root, requestedPath);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
attachMatchmaking(wss);

server.listen(port, '0.0.0.0', () => {
  console.log(`RTS prototype and matchmaking server listening on http://localhost:${port}`);
});
