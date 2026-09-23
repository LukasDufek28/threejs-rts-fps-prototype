import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

export function attachMatchmaking(wss) {
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

  wss.on('connection', socket => {
    socket.id = randomUUID();
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
}
