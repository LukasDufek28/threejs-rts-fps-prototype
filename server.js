import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8000);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const rooms = new Map();
const quickQueue = [];

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function pair(roomCode, first, second) {
  first.roomCode = roomCode;
  second.roomCode = roomCode;
  first.peerId = second.id;
  second.peerId = first.id;
  first.isHost = true;
  second.isHost = false;
  send(first, { type: 'matched', roomCode, peerId: second.id, isHost: true });
  send(second, { type: 'matched', roomCode, peerId: first.id, isHost: false });
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
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

const sockets = new WebSocketServer({ server, maxPayload: 16 * 1024 });
sockets.on('connection', socket => {
  socket.id = crypto.randomUUID();
  socket.roomCode = null;
  socket.peerId = null;

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Invalid signaling message.' }); }
    if (message.type === 'quick-match') {
      const waitingIndex = quickQueue.findIndex(candidate => candidate.readyState === WebSocket.OPEN && !candidate.peerId);
      if (waitingIndex >= 0) {
        const waiting = quickQueue.splice(waitingIndex, 1)[0];
        pair(waiting.roomCode, waiting, socket);
      } else {
        const roomCode = createRoomCode();
        rooms.set(roomCode, [socket]);
        socket.roomCode = roomCode;
        quickQueue.push(socket);
        send(socket, { type: 'waiting', roomCode });
      }
      return;
    }
    if (message.type === 'create-room') {
      const roomCode = createRoomCode();
      rooms.set(roomCode, [socket]);
      socket.roomCode = roomCode;
      send(socket, { type: 'waiting', roomCode });
      return;
    }
    if (message.type === 'join-room') {
      const roomCode = String(message.roomCode || '').trim().toUpperCase().slice(0, 8);
      const room = rooms.get(roomCode);
      if (!room || room.length !== 1 || room[0] === socket) return send(socket, { type: 'error', message: 'Room not found or already full.' });
      room.push(socket);
      pair(roomCode, room[0], socket);
      return;
    }
    if (message.type === 'signal') {
      const room = rooms.get(socket.roomCode);
      const peer = room?.find(candidate => candidate.id === socket.peerId && candidate.id === message.target);
      if (peer && ['offer', 'answer', 'ice'].includes(message.signal?.type)) {
        send(peer, { type: 'signal', from: socket.id, signal: message.signal });
      }
    }
  });

  socket.on('close', () => {
    const queueIndex = quickQueue.indexOf(socket);
    if (queueIndex >= 0) quickQueue.splice(queueIndex, 1);
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const peer = room.find(candidate => candidate !== socket);
    if (peer) {
      peer.peerId = null;
      send(peer, { type: 'peer-left' });
    }
    rooms.delete(socket.roomCode);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`RTS prototype and matchmaking server listening on http://localhost:${port}`);
});
