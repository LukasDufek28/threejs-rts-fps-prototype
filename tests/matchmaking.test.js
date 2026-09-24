import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { attachMatchmaking } from '../matchmaking-core.js';

function nextMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout=setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2000);
    function onMessage(raw) {
      const message=JSON.parse(raw.toString());
      if (message.type!==type) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    }
    socket.on('message', onMessage);
  });
}

for (const mode of ['quick', 'private']) {
  test(`${mode} match pairs players and relays game packets`, async () => {
    const server=createServer();
    const wss=new WebSocketServer({server});
    attachMatchmaking(wss);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const url=`ws://127.0.0.1:${server.address().port}`;
    const first=new WebSocket(url);
    const second=new WebSocket(url);
    try {
      await Promise.all([once(first,'open'),once(second,'open')]);
      const waiting=nextMessage(first,'waiting');
      first.send(JSON.stringify({type:mode==='quick' ? 'quick-match' : 'create-room'}));
      const {roomCode}=await waiting;
      const firstMatched=nextMessage(first,'matched');
      const secondMatched=nextMessage(second,'matched');
      second.send(JSON.stringify(mode==='quick' ? {type:'quick-match'} : {type:'join-room',roomCode}));
      const [host,guest]=await Promise.all([firstMatched,secondMatched]);
      assert.equal(host.roomCode,roomCode);
      assert.equal(guest.roomCode,roomCode);
      assert.equal(host.isHost,true);
      assert.equal(guest.isHost,false);
      assert.equal(typeof host.peerId,'string');
      assert.equal(typeof guest.peerId,'string');
      assert.equal(host.playerId,guest.peerId);
      assert.equal(guest.playerId,host.peerId);
      assert.deepEqual(host.spawn,guest.peerSpawn);
      assert.deepEqual(guest.spawn,host.peerSpawn);
      assert.ok(Math.hypot(host.spawn.x-guest.spawn.x,host.spawn.z-guest.spawn.z)>100);

      const position={type:'position',name:'Player one',x:4,z:8,yaw:1};
      const guestPacket=nextMessage(second,'game');
      first.send(JSON.stringify({type:'game',packet:position}));
      assert.deepEqual((await guestPacket).packet,position);

      const action={type:'action',action:{kind:'build',buildingType:'lumber',x:4,z:8}};
      const hostPacket=nextMessage(first,'game');
      second.send(JSON.stringify({type:'game',packet:action}));
      assert.deepEqual((await hostPacket).packet,action);

      const units={type:'units',units:[{id:'unit-1',x:12,z:16,yaw:2}]};
      const unitsPacket=nextMessage(second,'game');
      first.send(JSON.stringify({type:'game',packet:units}));
      assert.deepEqual((await unitsPacket).packet,units);

      const defeat={type:'action',action:{kind:'defeat'}};
      const resultPacket=nextMessage(first,'game');
      second.send(JSON.stringify({type:'game',packet:defeat}));
      assert.deepEqual((await resultPacket).packet,defeat);
    } finally {
      first.terminate();
      second.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('three players spawn one third of the arena apart and receive the same combat action', async () => {
  const server=createServer();
  const wss=new WebSocketServer({server});
  attachMatchmaking(wss);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}`;
  const players=[new WebSocket(url),new WebSocket(url),new WebSocket(url)];
  try {
    await Promise.all(players.map(socket => once(socket,'open')));
    const waiting=nextMessage(players[0],'waiting');
    players[0].send(JSON.stringify({type:'create-room'}));
    const {roomCode}=await waiting;
    const firstPair=[nextMessage(players[0],'matched'),nextMessage(players[1],'matched')];
    players[1].send(JSON.stringify({type:'join-room',roomCode}));
    await Promise.all(firstPair);
    const rosterMessages=players.map(socket => nextMessage(socket,'matched'));
    players[2].send(JSON.stringify({type:'join-room',roomCode}));
    const matched=await Promise.all(rosterMessages);
    for (const message of matched) {
      assert.equal(message.players.length,3);
      assert.deepEqual(message.spawn,message.players.find(player => player.id===message.playerId).spawn);
    }
    const positions=matched.map(message => message.spawn);
    for (let a=0;a<3;a++) for (let b=a+1;b<3;b++) {
      assert.ok(Math.hypot(positions[a].x-positions[b].x,positions[a].z-positions[b].z)>175);
    }
    const incoming=[nextMessage(players[1],'game'),nextMessage(players[2],'game')];
    const packet={type:'action',action:{kind:'player-hit',targetId:matched[1].playerId,amount:20}};
    players[0].send(JSON.stringify({type:'game',packet}));
    for (const received of await Promise.all(incoming)) {
      assert.deepEqual(received.packet,packet);
      assert.equal(received.from,matched[0].playerId);
    }
  } finally {
    players.forEach(socket => socket.terminate());
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
