import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const MAX_PLAYERS = 3;

export function attachMatchmaking(wss) {
  const rooms = new Map();

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

  function createRoom(socket, quick) {
    const code = createRoomCode();
    const room = { code, players:[socket], quick, started:false, angle:Math.random()*Math.PI*2 };
    rooms.set(code,room);
    socket.roomCode=code;
    send(socket,{type:'waiting',roomCode:code});
  }

  function announce(room) {
    const roster=room.players.map((socket,index) => {
      const angle=room.angle+index*2*Math.PI/room.players.length;
      return { id:socket.id, slot:index, spawn:{ x:Math.round(Math.cos(angle)*105), z:Math.round(Math.sin(angle)*105) } };
    });
    for (const [index,socket] of room.players.entries()) {
      send(socket,{
        type:'matched',roomCode:room.code,playerId:socket.id,isHost:index===0,
        spawn:roster[index].spawn,players:roster,
        peerId:roster.find(player => player.id!==socket.id)?.id,
        peerSpawn:roster.find(player => player.id!==socket.id)?.spawn
      });
    }
  }

  wss.on('connection', socket => {
    socket.id=randomUUID();
    socket.roomCode=null;

    socket.on('message', raw => {
      let message;
      try { message=JSON.parse(raw.toString()); }
      catch { return send(socket,{type:'error',message:'Invalid signaling message.'}); }
      if (message.type==='quick-match') {
        if (socket.roomCode) return;
        const room=[...rooms.values()].find(candidate => candidate.quick && !candidate.started && candidate.players.length<MAX_PLAYERS);
        if (!room) createRoom(socket,true);
        else {
          room.players.push(socket);
          socket.roomCode=room.code;
          announce(room);
        }
        return;
      }
      if (message.type==='create-room') {
        if (!socket.roomCode) createRoom(socket,false);
        return;
      }
      if (message.type==='join-room') {
        if (socket.roomCode) return;
        const code=String(message.roomCode||'').trim().toUpperCase().slice(0,8);
        const room=rooms.get(code);
        if (!room || room.started || room.players.length>=MAX_PLAYERS) {
          return send(socket,{type:'error',message:'Room not found, full, or already started.'});
        }
        room.players.push(socket);
        socket.roomCode=code;
        announce(room);
        return;
      }
      if (message.type==='game') {
        const room=rooms.get(socket.roomCode);
        if (!room || !room.players.includes(socket) || !['position','units','action'].includes(message.packet?.type)) return;
        if (message.packet.type==='action' && ['base','ready'].includes(message.packet.action?.kind)) room.started=true;
        for (const peer of room.players) if (peer!==socket) send(peer,{type:'game',from:socket.id,packet:message.packet});
      }
    });

    socket.on('close',() => {
      const room=rooms.get(socket.roomCode);
      if (!room) return;
      room.players.splice(room.players.indexOf(socket),1);
      for (const peer of room.players) send(peer,{type:'peer-left',playerId:socket.id});
      if (!room.players.length) rooms.delete(room.code);
    });
  });
}
