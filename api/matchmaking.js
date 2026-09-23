import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { attachMatchmaking } from '../matchmaking-core.js';

const server = createServer((_request, response) => {
  response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Upgrade this request to WebSocket.');
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
attachMatchmaking(wss);

export default server;
