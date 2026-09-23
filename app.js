import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Keep generated terrain and resource deposits aligned between connected peers.
let worldRandomState=0x5eed1234;
Math.random=() => {
  worldRandomState=(worldRandomState+0x6d2b79f5)|0;
  let value=worldRandomState;
  value=Math.imul(value^(value>>>15),value|1);
  value^=value+Math.imul(value^(value>>>7),value|61);
  return ((value^(value>>>14))>>>0)/4294967296;
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b7d8);
scene.fog = new THREE.Fog(0x87b7d8, 95, 280);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 330);
camera.position.set(0, 2.0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);
const playBtn = document.querySelector('#playBtn');
const quickMatchBtn = document.querySelector('#quickMatchBtn');
const createRoomBtn = document.querySelector('#createRoomBtn');
const joinRoomBtn = document.querySelector('#joinRoomBtn');
const playerNameInput = document.querySelector('#playerName');
const roomCodeInput = document.querySelector('#roomCode');
const onlineStatus = document.querySelector('#onlineStatus');
const startEl = document.querySelector('#start');
const enemyToggle = document.querySelector('#enemySpawning');
const detailsEl = document.querySelector('#details');
const detailTitle = document.querySelector('#detailTitle');
const detailBody = document.querySelector('#detailBody');
const detailActions = document.querySelector('#detailActions');
const buildMenu = document.querySelector('#buildMenu');
const buildOptions = document.querySelector('#buildOptions');
const inventoryEl = document.querySelector('#inventory');
const inventoryContents = document.querySelector('#inventoryContents');
const minimapCanvas = document.querySelector('#minimapCanvas');
const minimapContext = minimapCanvas.getContext('2d');
let uiMode = 'main';
let selectedObject = null;
let enemiesEnabled = true;
let enemySpawnTimer = 0;
const multiplayer = {
  socket:null, peer:null, channel:null, roomCode:'', peerId:'', isHost:false,
  name:'', remote:null, iceQueue:[], actionQueue:[], lastPositionSent:0, status:'Offline'
};

playerNameInput.value=localStorage.getItem('rts-player-name') || '';
function currentPlayerName() {
  const name=playerNameInput.value.trim().replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,20);
  if (!name) {
    onlineStatus.textContent='Enter a player name to continue.';
    playerNameInput.focus();
    return null;
  }
  playerNameInput.value=name;
  localStorage.setItem('rts-player-name',name);
  multiplayer.name=name;
  return name;
}

function setOnlineStatus(message) {
  multiplayer.status=message;
  onlineStatus.textContent=message;
  if (uiMode==='game') toast(message);
}

function beginSolo() {
  if (!currentPlayerName()) return;
  closeMultiplayer();
  uiMode='game';
  controls.lock();
}

playBtn.addEventListener('click',beginSolo);
quickMatchBtn.addEventListener('click',() => beginMatch('quick'));
createRoomBtn.addEventListener('click',() => beginMatch('create'));
joinRoomBtn.addEventListener('click',() => beginMatch('join',roomCodeInput.value));

function signalingURL() {
  const override=localStorage.getItem('rts-signaling-url');
  if (override) return override;
  return `${location.protocol==='https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

function beginMatch(mode,roomCode='') {
  if (!currentPlayerName()) return;
  if (mode==='join' && !roomCode.trim()) {
    onlineStatus.textContent='Enter a room code first.';
    roomCodeInput.focus();
    return;
  }
  closeMultiplayer();
  uiMode='game';
  controls.lock();
  setOnlineStatus('Connecting to matchmaking…');
  let socket;
  try { socket=new WebSocket(signalingURL()); }
  catch { setOnlineStatus('Could not open the matchmaking server.'); return; }
  multiplayer.socket=socket;
  socket.addEventListener('open',() => {
    const message=mode==='quick' ? {type:'quick-match'} : mode==='create' ? {type:'create-room'} : {type:'join-room',roomCode};
    socket.send(JSON.stringify(message));
  });
  socket.addEventListener('message',event => {
    let message;
    try { message=JSON.parse(event.data); } catch { return; }
    if (message.type==='waiting') {
      multiplayer.roomCode=message.roomCode;
      roomCodeInput.value=message.roomCode;
      setOnlineStatus(`Waiting for a player · room code ${message.roomCode}`);
    } else if (message.type==='matched') {
      multiplayer.roomCode=message.roomCode;
      multiplayer.peerId=message.peerId;
      multiplayer.isHost=message.isHost;
      roomCodeInput.value=message.roomCode;
      setOnlineStatus(`Match found · room ${message.roomCode} · connecting directly…`);
      createPeerConnection(message.isHost);
    } else if (message.type==='signal') {
      handleSignal(message.signal).catch(error => setOnlineStatus(`Connection negotiation failed: ${error.message}`));
    } else if (message.type==='peer-left') {
      clearRemotePlayer();
      setOnlineStatus('The other player disconnected. You can find another match.');
    } else if (message.type==='error') {
      setOnlineStatus(message.message || 'Matchmaking error.');
    }
  });
  socket.addEventListener('error',() => setOnlineStatus('Matchmaking server unavailable. Start the server with npm start.'));
  socket.addEventListener('close',() => {
    if (multiplayer.socket===socket && multiplayer.peer) setOnlineStatus('Matchmaking signaling closed; the direct game connection may continue.');
  });
}

function sendSignal(signal) {
  if (multiplayer.socket?.readyState===WebSocket.OPEN && multiplayer.peerId) {
    multiplayer.socket.send(JSON.stringify({type:'signal',target:multiplayer.peerId,signal}));
  }
}

function createPeerConnection(isHost) {
  const peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  multiplayer.peer=peer;
  multiplayer.iceQueue=[];
  peer.addEventListener('icecandidate',event => {
    if (event.candidate) sendSignal({type:'ice',candidate:event.candidate});
  });
  peer.addEventListener('connectionstatechange',() => {
    if (peer.connectionState==='connected') setOnlineStatus(`Connected to ${multiplayer.remote?.name || 'player'} · room ${multiplayer.roomCode}`);
    if (['failed','disconnected'].includes(peer.connectionState)) setOnlineStatus(`Peer connection ${peer.connectionState}. Try joining again.`);
  });
  peer.addEventListener('datachannel',event => attachDataChannel(event.channel));
  if (isHost) {
    attachDataChannel(peer.createDataChannel('game-presence',{ordered:true}));
    peer.createOffer().then(offer => peer.setLocalDescription(offer)).then(() => sendSignal({type:'offer',description:peer.localDescription})).catch(error => setOnlineStatus(`Could not start WebRTC: ${error.message}`));
  }
}

function attachDataChannel(channel) {
  multiplayer.channel=channel;
  channel.addEventListener('open',() => {
    setOnlineStatus(`Connected to the other player · room ${multiplayer.roomCode}`);
    for (const action of multiplayer.actionQueue.splice(0)) channel.send(JSON.stringify(action));
  });
  channel.addEventListener('close',() => {
    clearRemotePlayer();
    if (multiplayer.peer?.connectionState!=='closed') setOnlineStatus('Peer data connection closed.');
  });
  channel.addEventListener('message',event => {
    let message;
    try { message=JSON.parse(event.data); } catch { return; }
    if (message.type==='position') updateRemotePlayer(message);
    else if (message.type==='action') applyRemoteAction(message.action);
  });
}

async function handleSignal(signal) {
  const peer=multiplayer.peer;
  if (!peer) return;
  if (signal.type==='offer') {
    await peer.setRemoteDescription(signal.description);
    while (multiplayer.iceQueue.length) await peer.addIceCandidate(multiplayer.iceQueue.shift());
    const answer=await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendSignal({type:'answer',description:peer.localDescription});
  } else if (signal.type==='answer') {
    await peer.setRemoteDescription(signal.description);
    while (multiplayer.iceQueue.length) await peer.addIceCandidate(multiplayer.iceQueue.shift());
  } else if (signal.type==='ice') {
    if (!peer.remoteDescription) multiplayer.iceQueue.push(signal.candidate);
    else await peer.addIceCandidate(signal.candidate);
  }
}

function makeRemoteAvatar(name) {
  const avatar=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.32,.9,4,8),new THREE.MeshLambertMaterial({color:0x45c9c1}));
  body.position.y=.9;
  const marker=new THREE.Mesh(new THREE.ConeGeometry(.13,.35,5),new THREE.MeshLambertMaterial({color:0xffdb75}));
  marker.rotation.x=Math.PI/2;
  marker.position.set(0,1.2,.38);
  const canvas=document.createElement('canvas');
  canvas.width=512; canvas.height=128;
  const context=canvas.getContext('2d');
  context.font='bold 48px Arial';
  context.textAlign='center';
  context.lineWidth=8; context.strokeStyle='#12211a';
  context.strokeText(name,256,82);
  context.fillStyle='#ffffff'; context.fillText(name,256,82);
  const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false}));
  label.scale.set(3.2,.8,1);
  label.position.y=2.35;
  avatar.add(body,marker,label);
  avatar.userData.name=name;
  scene.add(avatar);
  return avatar;
}

function updateRemotePlayer(state) {
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z) || !Number.isFinite(state.yaw)) return;
  const name=String(state.name || 'Player').slice(0,20);
  if (!multiplayer.remote || multiplayer.remote.userData.name!==name) {
    clearRemotePlayer();
    multiplayer.remote=makeRemoteAvatar(name);
  }
  multiplayer.remote.position.set(THREE.MathUtils.clamp(state.x,-WORLD_RADIUS,WORLD_RADIUS),0,THREE.MathUtils.clamp(state.z,-WORLD_RADIUS,WORLD_RADIUS));
  multiplayer.remote.rotation.y=state.yaw;
}

function clearRemotePlayer() {
  if (multiplayer.remote) {
    scene.remove(multiplayer.remote);
    multiplayer.remote.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
  }
  multiplayer.remote=null;
}

function closeMultiplayer() {
  clearRemotePlayer();
  multiplayer.channel?.close();
  multiplayer.peer?.close();
  multiplayer.socket?.close();
  multiplayer.channel=null; multiplayer.peer=null; multiplayer.socket=null;
  multiplayer.peerId=''; multiplayer.roomCode=''; multiplayer.isHost=false;
  multiplayer.actionQueue=[];
  multiplayer.status='Offline';
}

function sendPeerAction(action) {
  const packet={type:'action',action};
  if (multiplayer.channel?.readyState==='open') multiplayer.channel.send(JSON.stringify(packet));
  else if (multiplayer.socket) multiplayer.actionQueue.push(packet);
}

function findBuildingAt(type,x,z) {
  return buildings.find(building => building.userData.type===type && Math.abs(building.position.x-x)<.1 && Math.abs(building.position.z-z)<.1);
}

function applyRemoteAction(action) {
  if (!action || typeof action.kind!=='string') return;
  if (action.kind==='build' && ['stockpile','granary','lumber','hunting','barracks','quarry'].includes(action.buildingType) && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    if (buildings.some(building => Math.hypot(building.position.x-action.x,building.position.z-action.z)<.5)) return;
    const price=costs[action.buildingType];
    if (!canAfford(price)) return toast('A shared build failed: resources differ between players');
    pay(price);
    createBuilding(action.buildingType,action.x,action.z);
  } else if (action.kind==='recruit' && ['swordsman','archer'].includes(action.unit) && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    const barracks=findBuildingAt('barracks',action.x,action.z);
    if (barracks && canAfford(recruitCosts[action.unit])) {
      pay(recruitCosts[action.unit]);
      const npc=makeNPC(action.unit,spawnPosition(barracks));
      npc.userData.home=barracks;
      barracks.userData.units.push(npc);
    }
  } else if (action.kind==='rally' && Number.isFinite(action.x) && Number.isFinite(action.z) && Number.isFinite(action.rallyX) && Number.isFinite(action.rallyZ)) {
    const barracks=findBuildingAt('barracks',action.x,action.z);
    if (barracks) setRallyPoint(barracks,new THREE.Vector3(action.rallyX,0,action.rallyZ),false);
  } else if (action.kind==='demolish' && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    const building=buildings.find(item => item.userData.type!=='house' && Math.abs(item.position.x-action.x)<.1 && Math.abs(item.position.z-action.z)<.1);
    if (building) demolishSelectedBuilding(building,false);
  }
}
controls.addEventListener('lock', () => { startEl.style.display = 'none'; });
controls.addEventListener('unlock', () => {
  if (uiMode === 'game') uiMode = 'main';
  startEl.style.display = uiMode === 'main' ? 'flex' : 'none';
});

const hemi = new THREE.HemisphereLight(0xddeeff, 0x56603a, 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const WORLD_RADIUS = 120;
const GRID = 4;
const PLAYER_RADIUS = 0.55;
const BUILDING_HALF_SIZE = 1.6;
const WORK_RANGE = { lumber:32, hunting:40, quarry:35 };
const STOCKPILE_CAPACITY = { wood:120, food:0, stone:120 };
const GRANARY_CAPACITY = { wood:0, food:80, stone:0 };
const RESOURCE_KINDS = ['wood','food','stone'];
const TREE_LOGS = 3;
const WOOD_PER_BATCH = 18;
const MEAT_PER_DEER = 6;
const MULE_LOAD = 32;
const QUARRY_MINING_TIME = 6.5;
const HUNTER_CARRY_SPEED = 1.25;
const EYE_HEIGHT = 2;
const WALK_SPEED = 7.5;
const SPRINT_MULTIPLIER = 1.65;
const JUMP_SPEED = 8;
const GRAVITY = 20;
const keys = {};
let jumpRequested = false;
let verticalVelocity = 0;
let grounded = true;
const clock = new THREE.Clock();
let selectedBuild = null;
let buildGhost = null;
let lastToastTimer = null;

const resources = { wood: 0, food: 0, stone: 0 };
const costs = {
  stockpile: {},
  granary: {},
  lumber: { wood: 3 },
  hunting: { wood: 5 },
  barracks: { stone: 15 },
  quarry: { wood: 20 }
};
const recruitCosts = {
  swordsman: { food: 10 },
  archer: { food: 12 }
};

const buildings = [];
const trees = [];
const rocks = [];
const stoneDeposits = [];
const deer = [];
const raiders = [];
const npcs = [];
const herds = [];
let deerSpawnTimer = 0;

const statsEl = document.querySelector('#stats');
const toastEl = document.querySelector('#toast');

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => toastEl.style.opacity = '0', 1200);
}

function rand(a, b) { return a + Math.random() * (b - a); }
function dist2D(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.hypot(dx, dz);
}
function randomPointInCircle(minR=8, maxR=WORLD_RADIUS-4) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(rand(minR*minR, maxR*maxR));
  return new THREE.Vector3(Math.cos(a)*r, 0, Math.sin(a)*r);
}
function clampToWorld(p, margin=1) {
  const r = Math.hypot(p.x, p.z);
  const max = WORLD_RADIUS - margin;
  if (r > max) {
    p.x = p.x / r * max;
    p.z = p.z / r * max;
  }
  return p;
}

const groundMat = new THREE.MeshLambertMaterial({ color: 0x6f9854 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS, 96), groundMat);
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
scene.add(ground);

// Slight random terrain patches
for (let i=0; i<130; i++) {
  const p = randomPointInCircle(0, WORLD_RADIUS-2);
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(rand(1.4,4.5), 12),
    new THREE.MeshLambertMaterial({ color: Math.random() < .5 ? 0x769f58 : 0x66894d })
  );
  patch.rotation.x = -Math.PI/2;
  patch.position.set(p.x, 0.012, p.z);
  scene.add(patch);
}

// Hard impassable zone wall
const wall = new THREE.Mesh(
  new THREE.CylinderGeometry(WORLD_RADIUS+0.65, WORLD_RADIUS+0.65, 5, 96, 1, true),
  new THREE.MeshLambertMaterial({ color: 0x9b6a45, transparent:true, opacity:.72, side:THREE.DoubleSide })
);
wall.position.y = 2.5;
scene.add(wall);

function makeTree(pos) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(.22,.32,2.1,6),
    new THREE.MeshLambertMaterial({ color:0x704526 })
  );
  trunk.position.y = 1.05;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.05,2.6,7),
    new THREE.MeshLambertMaterial({ color:0x2f6e32 })
  );
  crown.position.y = 3.0;
  trunk.castShadow = crown.castShadow = true;
  group.add(trunk,crown);
  group.position.copy(pos);
  group.userData.alive = true;
  group.userData.logsRemaining = TREE_LOGS;
  group.userData.crown = crown;
  scene.add(group);
  trees.push(group);
}
for (let i=0; i<320; i++) makeTree(randomPointInCircle(14, WORLD_RADIUS-3));

function makeRock(pos) {
  const group=new THREE.Group();
  const stoneMat=new THREE.MeshLambertMaterial({color:0x858b84});
  for (let i=0;i<3;i++) {
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.75-i*.13,0),stoneMat);
    rock.position.set((i-1)*.55,.5,.2*(i%2));
    rock.rotation.y=i*.7;
    rock.castShadow=true;
    group.add(rock);
  }
  group.position.copy(pos);
  group.userData={alive:true,stoneRemaining:40};
  scene.add(group);
  rocks.push(group);
}
function makeStoneDeposit(pos) {
  const patch = new THREE.Mesh(new THREE.CircleGeometry(5.6,16),new THREE.MeshLambertMaterial({color:0x8c9188}));
  patch.rotation.x=-Math.PI/2;
  patch.position.set(pos.x,.018,pos.z);
  scene.add(patch);
  const deposit={position:pos,rocks:[],quarry:null};
  for (const tree of trees) {
    if (tree.userData.alive && dist2D(tree.position,pos)<6.5) {
      tree.userData.alive=false;
      scene.remove(tree);
    }
  }
  for (let i=0;i<7;i++) {
    const angle=i*Math.PI*2/7;
    const rockPos=new THREE.Vector3(pos.x+Math.cos(angle)*4.25,0,pos.z+Math.sin(angle)*4.25);
    makeRock(rockPos);
    const rock=rocks[rocks.length-1];
    rock.userData.deposit=deposit;
    deposit.rocks.push(rock);
  }
  stoneDeposits.push(deposit);
}
for (let i=0, attempts=0;i<12 && attempts<500;attempts++) {
  const point=randomPointInCircle(22,WORLD_RADIUS-9);
  const pos=new THREE.Vector3(Math.round(point.x/GRID)*GRID,0,Math.round(point.z/GRID)*GRID);
  if (stoneDeposits.some(deposit => dist2D(deposit.position,pos)<16)) continue;
  makeStoneDeposit(pos);
  i++;
}

function makeDeer(pos,herd) {
  const g = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({color:0xa46d3f});
  const lightFur = new THREE.MeshLambertMaterial({color:0xc08a57});
  const hornMat = new THREE.MeshLambertMaterial({color:0xd8bf8a});
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(.58,.62,1.18),fur
  );
  body.position.y = .75;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(.38,.42,.42),lightFur
  );
  head.position.set(0,1.13,.72);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(.28,.18,.27),lightFur);
  muzzle.position.set(0,.99,1.02);
  g.add(body,head,muzzle);
  const legs=[];
  for (const x of [-.2,.2]) for (const z of [-.4,.4]) {
    const pivot = new THREE.Group();
    pivot.position.set(x,.56,z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.055,.075,.58,5),fur);
    leg.position.y=-.28;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }
  const pupils=[],crosses=[];
  for (const x of [-.13,.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.065,7,5),new THREE.MeshBasicMaterial({color:0xffffff}));
    eye.position.set(x,1.18,.95);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(.03,6,4),new THREE.MeshBasicMaterial({color:0x161411}));
    pupil.position.set(x,1.18,1.005);
    g.add(eye,pupil);
    pupils.push(pupil);
    for (const tilt of [-.7,.7]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(.16,.025,.02),new THREE.MeshBasicMaterial({color:0x171411}));
      cross.position.set(x,1.18,1.02);
      cross.rotation.z=tilt;
      cross.visible=false;
      g.add(cross);
      crosses.push(cross);
    }
  }
  for (const x of [-.18,.18]) {
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(.025,.055,.5,5),hornMat);
    horn.position.set(x*1.45,1.56,.66);
    horn.rotation.z=x<0 ? .4 : -.4;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(.018,.035,.28,5),hornMat);
    branch.position.set(x*1.75,1.72,.78);
    branch.rotation.z=x<0 ? -.7 : .7;
    g.add(horn,branch);
  }
  g.position.copy(pos);
  g.userData = { alive:true, hp:18, herd, legs, pupils, crosses, gait:rand(0,6), offset:new THREE.Vector3() };
  addSelectionArrow(g,2.05);
  scene.add(g);
  deer.push(g);
  return g;
}

function spawnHerd(edge=false) {
  const size=Math.floor(rand(3,7));
  let center=randomPointInCircle(edge ? WORLD_RADIUS-18 : 18,edge ? WORLD_RADIUS-12 : 70);
  for (let i=0;i<20 && blockedByBuilding(center,3);i++) center=randomPointInCircle(18,WORLD_RADIUS-12);
  const herd={members:[],heading:Math.atan2(-center.x,-center.z),turnIn:rand(2,5)};
  for (let i=0;i<size;i++) {
    let offset=i===0 ? new THREE.Vector3() : new THREE.Vector3(rand(-2.5,2.5),0,rand(-3,3));
    for (let attempt=0;attempt<12 && blockedByBuilding(center.clone().add(offset),.5);attempt++) {
      offset=new THREE.Vector3(rand(-3,3),0,rand(-3,3));
    }
    const animal=makeDeer(center.clone().add(offset),herd);
    animal.userData.offset.copy(offset);
    herd.members.push(animal);
  }
  herds.push(herd);
}
for (let i=0;i<4;i++) spawnHerd();

function makeRaider(pos) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(.35,.85,4,8),
    new THREE.MeshLambertMaterial({color:0x7a2424})
  );
  body.position.y = .85;
  const sword = new THREE.Mesh(
    new THREE.BoxGeometry(.08,.08,1.0),
    new THREE.MeshLambertMaterial({color:0xcccccc})
  );
  sword.position.set(.45,.85,.35);
  sword.rotation.x = .6;
  g.add(body,sword);
  g.position.copy(pos);
  g.userData = { alive:true, hp:35, dir:Math.random()*Math.PI*2, turnIn:rand(1,3), attackTimer:0 };
  scene.add(g);
  raiders.push(g);
}

function syncEnemies() {
  enemiesEnabled = enemyToggle.checked;
  if (!enemiesEnabled) {
    for (const r of raiders) { r.userData.alive = false; scene.remove(r); }
    enemySpawnTimer = 0;
  } else if (uiMode !== 'main') {
    const alive = raiders.filter(r => r.userData.alive).length;
    for (let i=alive; i<7; i++) makeRaider(randomPointInCircle(24, WORLD_RADIUS-6));
  }
}
enemyToggle.addEventListener('change', syncEnemies);
playBtn.addEventListener('click', syncEnemies);

function addSelectionArrow(group, height) {
  const arrow = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color:0xffde49, depthTest:false, depthWrite:false });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.3,.55,6), mat);
  tip.rotation.z = Math.PI;
  arrow.add(tip);
  arrow.position.y = height;
  arrow.renderOrder = 10;
  arrow.visible = false;
  group.add(arrow);
  group.userData.selectionArrow = arrow;
}

function makeBuildingMesh(type, ghost=false) {
  const g = new THREE.Group();
  let baseColor = 0x9f835f;
  let roofColor = 0x57402f;
  if (type === 'house') { baseColor = 0xc2a177; roofColor = 0x733e32; }
  if (type === 'stockpile') { baseColor = 0x8d806b; roofColor = 0x715b3e; }
  if (type === 'granary') { baseColor = 0xb9a378; roofColor = 0x785337; }
  if (type === 'hunting') { baseColor = 0x8d704e; roofColor = 0x3e5f32; }
  if (type === 'barracks') { baseColor = 0x777777; roofColor = 0x4a4a4a; }
  if (type === 'quarry') { baseColor = 0x8d8d82; roofColor = 0x565b5d; }

  const mat = new THREE.MeshLambertMaterial({ color:baseColor, transparent:ghost, opacity:ghost?.45:1 });
  const roofMat = new THREE.MeshLambertMaterial({ color:roofColor, transparent:ghost, opacity:ghost?.45:1 });

  if (type !== 'stockpile') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2,2.4,3.2), mat);
    base.position.y = 1.2;
    base.castShadow = true;
    g.add(base);
    if (type === 'granary') {
      const opening = new THREE.Mesh(new THREE.BoxGeometry(2.5,1.25,.08),new THREE.MeshLambertMaterial({color:0x3b291e,transparent:ghost,opacity:ghost?.45:1}));
      opening.position.set(0,1.34,1.65);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8,.18,.48),roofMat);
      counter.position.set(0,.64,1.82);
      g.add(opening,counter);
    } else {
      const door = new THREE.Mesh(new THREE.BoxGeometry(.95,1.55,.13), new THREE.MeshLambertMaterial({color:0x493426, transparent:ghost, opacity:ghost?.45:1}));
      door.position.set(0,.78,1.67);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.22,.16,.2), roofMat);
      lintel.position.set(0,1.58,1.71);
      g.add(door,lintel);
      for (const x of [-1.08,1.08]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(.42,.48,.13), new THREE.MeshLambertMaterial({color:0x3e5c64, transparent:ghost, opacity:ghost?.45:1}));
        window.position.set(x,1.45,1.67);
        g.add(window);
      }
    }
  } else {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(3.4,.22,3.4),mat);
    floor.position.y=.11;
    floor.receiveShadow=true;
    g.add(floor);
    for (const z of [-1.62,1.62]) {
      const curb=new THREE.Mesh(new THREE.BoxGeometry(3.4,.32,.16),roofMat);
      curb.position.set(0,.28,z);
      g.add(curb);
    }
    for (const x of [-1.62,1.62]) {
      const curb=new THREE.Mesh(new THREE.BoxGeometry(.16,.32,3.4),roofMat);
      curb.position.set(x,.28,0);
      g.add(curb);
    }
  }
  if (type !== 'stockpile') {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7,1.55,4), roofMat);
    roof.position.y = 3.15;
    roof.rotation.y = Math.PI/4;
    roof.castShadow = true;
    g.add(roof);
  }

  if (type === 'lumber') {
    const logMat = new THREE.MeshLambertMaterial({color:0x6e4529, transparent:ghost, opacity:ghost?.45:1});
    for (let i=0;i<3;i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(.18,.2,2.1,7), logMat);
      // The feet sit outside the left wall while the tops rest against it.
      log.rotation.z = -.23-i*.035;
      log.position.set(-1.89, 1.05, -.75+i*.7);
      g.add(log);
    }
    // Keep the axe head attached to the handle as the whole tool leans on the right wall.
    const axe = new THREE.Group();
    axe.position.set(2.02, .04, .7);
    axe.rotation.z = .28;
    const axeHandle = new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.48,6),logMat);
    axeHandle.position.y = .74;
    const axeHead = new THREE.Mesh(new THREE.BoxGeometry(.46,.27,.12),new THREE.MeshLambertMaterial({color:0xbfc7c8, transparent:ghost, opacity:ghost?.45:1}));
    axeHead.position.set(.18,1.37,0);
    axe.add(axeHandle,axeHead);
    g.add(axe);
  }
  if (type === 'hunting') {
    const hornMat = new THREE.MeshLambertMaterial({color:0xd7c9a2, transparent:ghost, opacity:ghost?.45:1});
    for (const side of [-1,1]) {
      const horn = new THREE.Mesh(new THREE.CylinderGeometry(.035,.075,.75,5),hornMat);
      horn.position.set(side*.28,2.05,1.73);
      horn.rotation.z=side*.48;
      g.add(horn);
    }
  }
  if (type === 'barracks') {
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(.04,.04,3,5),
      new THREE.MeshLambertMaterial({color:0x333333, transparent:ghost, opacity:ghost?.45:1})
    );
    flagPole.position.set(1.7,2.5,0);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(.72,.42,.06),new THREE.MeshLambertMaterial({color:0x9c3830, transparent:ghost, opacity:ghost?.45:1}));
    flag.position.set(2.05,3.6,0);
    g.add(flagPole,flag);
  }
  if (type === 'quarry') {
    const stoneMat=new THREE.MeshLambertMaterial({color:0xb0b4ac,transparent:ghost,opacity:ghost?.45:1});
    const quarryPile=[];
    for (let i=0;i<8;i++) {
      const block=new THREE.Mesh(new THREE.DodecahedronGeometry(.23,0),stoneMat);
      block.position.set(-1.2+(i%4)*.48,.28+Math.floor(i/4)*.36,1.86);
      block.visible=ghost;
      g.add(block);
      quarryPile.push(block);
    }
    g.userData.quarryPile=quarryPile;
  }
  if (type === 'house') {
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(.55,1.2,.55), new THREE.MeshLambertMaterial({color:0x7d4b3c, transparent:ghost, opacity:ghost?.45:1}));
    chimney.position.set(.9,3.4,-.5);
    g.add(chimney);
  }
  if (type === 'stockpile') {
    const woodMat = new THREE.MeshLambertMaterial({color:0x79502d, transparent:ghost, opacity:ghost?.45:1});
    const stoneMat = new THREE.MeshLambertMaterial({color:0x9da19a, transparent:ghost, opacity:ghost?.45:1});
    const piles = { wood:[], stone:[] };
    for (let i=0;i<8;i++) {
      const row = Math.floor(i/4), col=i%4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.7,6),woodMat);
      log.rotation.z=Math.PI/2;
      log.position.set(-.88+col*.16,.38+row*.31,-.65+col*.25);
      g.add(log);
      log.userData.baseY=log.position.y;
      log.userData.baseScale=log.scale.clone();
      log.userData.fill=ghost ? 1 : 0;
      piles.wood.push(log);
      if (!ghost) log.visible=false;
    }
    for (let i=0;i<8;i++) {
      const block=new THREE.Mesh(new THREE.BoxGeometry(.38,.28,.38),stoneMat);
      block.position.set(.35+(i%4)*.4,.39+Math.floor(i/4)*.3,.55);
      block.userData.baseY=block.position.y;
      block.userData.baseScale=block.scale.clone();
      block.userData.fill=ghost ? 1 : 0;
      if (!ghost) block.visible=false;
      g.add(block);
      piles.stone.push(block);
    }
    g.userData.stockVisuals = piles;
  }
  if (type === 'granary') {
    const meatMat = new THREE.MeshLambertMaterial({color:0xa63a32, transparent:ghost, opacity:ghost?.45:1});
    const boneMat = new THREE.MeshLambertMaterial({color:0xe8d8bd, transparent:ghost, opacity:ghost?.45:1});
    const piles=[];
    for (let i=0;i<8;i++) {
      const cut=new THREE.Group();
      const meat=new THREE.Mesh(new THREE.DodecahedronGeometry(.28,0),meatMat);
      meat.scale.set(1.2,.8,.85);
      const bone=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.33,6),boneMat);
      bone.rotation.z=Math.PI/2;
      bone.position.set(.32,.015,0);
      const boneEnd=new THREE.Mesh(new THREE.SphereGeometry(.08,6,5),boneMat);
      boneEnd.position.set(.48,.015,0);
      cut.add(meat,bone,boneEnd);
      // Food visible through the granary's front serving opening.
      cut.position.set(-.6+(i%4)*.4,1.05+Math.floor(i/4)*.38,1.72);
      cut.scale.setScalar(.65);
      cut.userData.baseY=cut.position.y;
      cut.userData.baseScale=cut.scale.clone();
      cut.userData.fill=ghost ? 1 : 0;
      if (!ghost) cut.visible=false;
      g.add(cut);
      piles.push(cut);
    }
    g.userData.stockVisuals={food:piles};
  }
  g.userData.type = type;
  if (!ghost) addSelectionArrow(g, type === 'stockpile' ? 2.15 : 4.45);
  return g;
}

function quarryDepositAt(x,z) {
  return stoneDeposits.find(deposit => Math.hypot(deposit.position.x-x,deposit.position.z-z)<2 && !deposit.quarry && deposit.rocks.some(rock => rock.userData.alive));
}
function isBuildingSpotFree(x,z,type) {
  if (Math.hypot(x,z) > WORLD_RADIUS-4) return false;
  if (type === 'quarry' && !quarryDepositAt(x,z)) return false;
  if (type !== 'quarry' && stoneDeposits.some(deposit => Math.hypot(deposit.position.x-x,deposit.position.z-z)<3.8)) return false;
  for (const b of buildings) if (Math.abs(b.position.x-x)<3.8 && Math.abs(b.position.z-z)<3.8) return false;
  for (const t of trees) if (t.userData.alive && Math.hypot(t.position.x-x,t.position.z-z) < 2.3) return false;
  for (const rock of rocks) if (rock.userData.alive && Math.hypot(rock.position.x-x,rock.position.z-z)<2.6) return false;
  for (const d of deer) if (d.userData.alive && Math.hypot(d.position.x-x,d.position.z-z) < 2.4) return false;
  for (const n of npcs) if (Math.hypot(n.position.x-x,n.position.z-z) < 2.3) return false;
  if (Math.hypot(camera.position.x-x,camera.position.z-z)<2.4) return false;
  return true;
}

function storageCapacity() {
  const count = type => buildings.filter(b => b.userData.type === type).length;
  return {
    wood:count('stockpile')*STOCKPILE_CAPACITY.wood,
    food:count('granary')*GRANARY_CAPACITY.food,
    stone:count('stockpile')*STOCKPILE_CAPACITY.stone
  };
}

function buildingStorageCapacity(building, kind) {
  return (building.userData.type === 'granary' ? GRANARY_CAPACITY : STOCKPILE_CAPACITY)[kind];
}

function syncResources() {
  for (const kind of RESOURCE_KINDS) {
    resources[kind] = buildings.reduce((total, building) => total + (building.userData.stock?.[kind] || 0), 0);
  }
}

function addResource(kind, amount, preferred = null) {
  const depots = buildings.filter(building => building.userData.stock);
  if (preferred && depots.includes(preferred)) {
    depots.splice(depots.indexOf(preferred), 1);
    depots.unshift(preferred);
  }
  let remaining = amount;
  for (const building of depots) {
    const room = buildingStorageCapacity(building, kind) - building.userData.stock[kind];
    const stored = Math.min(remaining, Math.max(0, room));
    building.userData.stock[kind] += stored;
    remaining -= stored;
    if (!remaining) break;
  }
  syncResources();
  return amount - remaining;
}

function removeResource(kind, amount) {
  let remaining = amount;
  for (const building of buildings) {
    if (!building.userData.stock) continue;
    const taken = Math.min(remaining, building.userData.stock[kind]);
    building.userData.stock[kind] -= taken;
    remaining -= taken;
    if (!remaining) break;
  }
  syncResources();
}

function updateStorageVisuals() {
  const stores = buildings.filter(b => b.userData.stockVisuals);
  for (const store of stores) {
    for (const kind of RESOURCE_KINDS) {
      const perStore = buildingStorageCapacity(store,kind);
      if (!perStore) continue;
      const stored = store.userData.stock[kind];
      const fraction = Math.min(1,stored/perStore);
      const piles = store.userData.stockVisuals[kind];
      for (let j=0;j<piles.length;j++) {
        const pile=piles[j];
        const target=j < Math.ceil(fraction*piles.length) ? 1 : 0;
        pile.userData.fill+= (target-pile.userData.fill)*.16;
        pile.visible=pile.userData.fill>.02;
        pile.scale.copy(pile.userData.baseScale).multiplyScalar(Math.max(.01,pile.userData.fill));
        pile.position.y=pile.userData.baseY-(1-pile.userData.fill)*.18;
      }
    }
  }
  for (const quarry of buildings) {
    if (quarry.userData.type!=='quarry') continue;
    const visible=Math.ceil(quarry.userData.stoneBuffer/MULE_LOAD*quarry.userData.quarryPile.length);
    quarry.userData.quarryPile.forEach((stone,index) => stone.visible=index<visible);
  }
}

function canAfford(cost) {
  return Object.entries(cost).every(([k,v]) => resources[k] >= v);
}
function pay(cost) {
  for (const [k,v] of Object.entries(cost)) removeResource(k,v);
}
const buildingChoices = [
  ['lumber','Lumber Camp','3 wood','1'],
  ['hunting','Hunting Lodge','5 wood','2'],
  ['barracks','Barracks','15 stone','3'],
  ['stockpile','Stockpile','free','4'],
  ['quarry','Quarry','20 wood','5'],
  ['granary','Granary','free','6']
];
for (const [type,name,cost,key] of buildingChoices) {
  const button = document.createElement('button');
  button.textContent = `${key} · ${name} · ${cost}`;
  button.addEventListener('click', () => {
    selectBuilding(type);
    closeBuildMenu();
  });
  buildOptions.append(button);
}
function openBuildMenu() {
  uiMode = 'buildMenu';
  buildMenu.hidden = false;
  controls.unlock();
}
function closeBuildMenu() {
  buildMenu.hidden = true;
  uiMode = 'game';
  controls.lock();
}
function selectBuilding(type) {
  clearSelection();
  selectedBuild = type;
  if (buildGhost) scene.remove(buildGhost);
  buildGhost = makeBuildingMesh(type,true);
  scene.add(buildGhost);
  toast(type === 'quarry' ? 'Build mode: quarry · place on a gray stone deposit' : `Build mode: ${type}`);
}
function cancelBuild() {
  selectedBuild = null;
  if (buildGhost) scene.remove(buildGhost);
  buildGhost = null;
}

function getAimGroundPoint() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  if (dir.y >= -0.02) dir.y = -0.02;
  const t = (0 - origin.y) / dir.y;
  if (t < 0 || t > 95) return null;
  return origin.add(dir.multiplyScalar(t));
}
function updateGhost() {
  if (!buildGhost) return;
  const p = getAimGroundPoint();
  if (!p) { buildGhost.visible = false; return; }
  buildGhost.visible = true;
  const x = Math.round(p.x / GRID) * GRID;
  const z = Math.round(p.z / GRID) * GRID;
  buildGhost.position.set(x,0,z);
  const ok = isBuildingSpotFree(x,z,selectedBuild) && canAfford(costs[selectedBuild]);
  buildGhost.traverse(o => {
    if (o.material?.emissive) o.material.emissive.set(ok ? 0x143a14 : 0x481111);
  });
}

function placeBuilding() {
  if (!selectedBuild || !buildGhost?.visible) return;
  const {x,z} = buildGhost.position;
  if (!isBuildingSpotFree(x,z,selectedBuild)) return toast(selectedBuild === 'quarry' ? 'Build the quarry on an empty stone deposit' : 'Blocked tile');
  const cost = costs[selectedBuild];
  if (!canAfford(cost)) return toast('Not enough resources');
  pay(cost);
  createBuilding(selectedBuild,x,z);
  sendPeerAction({kind:'build',buildingType:selectedBuild,x,z});
  toast(`${selectedBuild} built`);
}

function createBuilding(type,x,z) {
  const b = makeBuildingMesh(type,false);
  b.position.set(x,0,z);
  b.userData.radius = 2.0;
  b.userData.units = [];
  b.userData.rallyPoint = null;
  b.userData.rallyMarker = null;
  b.userData.rangeIndicator = null;
  if (type === 'lumber' || type === 'hunting' || type === 'quarry') {
    const sleepingSign=new THREE.Sprite(new THREE.SpriteMaterial({map:sleepTexture,transparent:true,depthTest:false,depthWrite:false}));
    sleepingSign.position.set(.5,5.2,0);
    sleepingSign.scale.set(1.7,.85,1);
    sleepingSign.renderOrder=12;
    sleepingSign.visible=false;
    b.add(sleepingSign);
    b.userData.sleepingSign=sleepingSign;
  }
  if (type === 'stockpile' || type === 'granary') b.userData.stock = { wood:0, food:0, stone:0 };
  if (type === 'quarry') {
    b.userData.deposit=quarryDepositAt(x,z);
    b.userData.deposit.quarry=b;
    b.userData.stoneBuffer=0;
    b.userData.mule=null;
    b.userData.muleRespawn=0;
    b.userData.handler=null;
    b.userData.handlerRespawn=0;
    const lead=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0x6a482b}));
    lead.frustumCulled=false;
    lead.visible=false;
    b.userData.muleLead=lead;
    scene.add(lead);
  }
  scene.add(b);
  buildings.push(b);
  if (WORK_RANGE[type]) {
    const range = WORK_RANGE[type];
    const indicator = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(range,64),new THREE.MeshBasicMaterial({color:0xf5dc70,transparent:true,opacity:.065,side:THREE.DoubleSide,depthWrite:false}));
    fill.rotation.x=-Math.PI/2;
    fill.position.y=.025;
    const edge = new THREE.Mesh(new THREE.RingGeometry(range-.15,range+.15,96),new THREE.MeshBasicMaterial({color:0xf5dc70,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));
    edge.rotation.x=-Math.PI/2;
    edge.position.y=.04;
    indicator.add(fill,edge);
    indicator.position.set(x,0,z);
    indicator.visible=false;
    scene.add(indicator);
    b.userData.rangeIndicator=indicator;
  }
  if (type === 'lumber' || type === 'hunting') {
    const kind = type === 'lumber' ? 'lumberjack' : 'hunter';
    const worker = makeNPC(kind, spawnPosition(b));
    worker.userData.home = b;
    b.userData.units.push(worker);
  }
  if (type === 'quarry') {
    for (let i=0;i<2;i++) {
      const worker=makeNPC('quarryman',spawnPosition(b));
      worker.userData.home=b;
      b.userData.units.push(worker);
    }
    const mule=makeNPC('mule',spawnPosition(b,.65));
    mule.userData.home=b;
    b.userData.mule=mule;
    b.userData.units.push(mule);
    const handler=makeNPC('muleHandler',spawnPosition(b));
    handler.userData.home=b;
    b.userData.handler=handler;
    b.userData.units.push(handler);
  }
  if (type === 'barracks') {
    for (const unit of npcs) {
      if ((unit.userData.kind==='swordsman' || unit.userData.kind==='archer') && !unit.userData.home) {
        unit.userData.home=b;
        unit.userData.orphanRally=null;
        b.userData.units.push(unit);
      }
    }
  }
  updateStorageVisuals();
  return b;
}

function spawnPosition(building,collisionRadius=.32) {
  for (const radius of [2.5,3.3,4.2,5.2]) {
    for (let i=0;i<20;i++) {
      const angle = rand(0, Math.PI*2);
      const pos = building.position.clone().add(new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
      if (!blockedByBuilding(pos,collisionRadius)) return clampToWorld(pos,2);
    }
  }
  return clampToWorld(building.position.clone().add(new THREE.Vector3(0,0,6)),2);
}

function makeSleepTexture() {
  const canvas=document.createElement('canvas');
  canvas.width=128;
  canvas.height=64;
  const ctx=canvas.getContext('2d');
  ctx.font='bold 43px Arial';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.lineWidth=5;
  ctx.strokeStyle='#17384a';
  ctx.fillStyle='#d9f5ff';
  ctx.strokeText('ZZZ',64,34);
  ctx.fillText('ZZZ',64,34);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
const sleepTexture=makeSleepTexture();

function makeNPC(kind, pos) {
  const g = new THREE.Group();
  const model = new THREE.Group();
  const colors = { lumberjack:0x3d6ca8, hunter:0x7d5c2c, quarryman:0x686f77, muleHandler:0x816746, swordsman:0x3f3f46, archer:0x557344 };
  const eyeMat = new THREE.MeshBasicMaterial({ color:0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color:0x171b16 });
  if (kind !== 'mule') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28,.75,4,8),new THREE.MeshLambertMaterial({color:colors[kind]}));
    body.position.y=.76;
    model.add(body);
    for (const x of [-.12,.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.075,8,6), eyeMat);
      eye.position.set(x,1.03,.275);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(.036,8,6), pupilMat);
      pupil.position.set(x,1.03,.336);
      model.add(eye,pupil);
    }
  }
  const steel = new THREE.MeshLambertMaterial({ color:0xd6dce0 });
  const wood = new THREE.MeshLambertMaterial({ color:0x654026 });
  const workerHands=[];
  if (kind==='lumberjack' || kind==='hunter' || kind==='quarryman' || kind==='muleHandler') {
    const handMat=new THREE.MeshLambertMaterial({color:0xc8986c});
    for (const side of [-1,1]) {
      const hand=new THREE.Mesh(new THREE.SphereGeometry(.09,7,5),handMat);
      hand.position.set(side*.32,.65,.25);
      model.add(hand);
      workerHands.push(hand);
    }
  }
  let carriedLogs=null;
  let axe=null;
  let pickaxe=null;
  let carriedStone=null;
  let stonePacks=null;
  const muleLegs=[];
  if (kind==='mule') {
    const hide=new THREE.MeshLambertMaterial({color:0x806548});
    const darkHide=new THREE.MeshLambertMaterial({color:0x503d31});
    const packMat=new THREE.MeshLambertMaterial({color:0x9a7041});
    const stoneMat=new THREE.MeshLambertMaterial({color:0xa2a6a0});
    const torso=new THREE.Mesh(new THREE.BoxGeometry(.82,.75,1.55),hide);
    torso.position.y=1.12;
    const neck=new THREE.Mesh(new THREE.BoxGeometry(.42,.78,.48),hide);
    neck.position.set(0,1.55,.78);
    neck.rotation.x=-.3;
    const head=new THREE.Mesh(new THREE.BoxGeometry(.48,.46,.58),hide);
    head.position.set(0,1.72,1.08);
    const muzzle=new THREE.Mesh(new THREE.BoxGeometry(.42,.24,.26),darkHide);
    muzzle.position.set(0,1.57,1.47);
    model.add(torso,neck,head,muzzle);
    for (const side of [-1,1]) {
      const ear=new THREE.Mesh(new THREE.ConeGeometry(.11,.55,5),darkHide);
      ear.position.set(side*.17,2.18,.94);
      model.add(ear);
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.07,7,6),eyeMat);
      eye.position.set(side*.25,1.78,1.2);
      const pupil=new THREE.Mesh(new THREE.SphereGeometry(.035,7,6),pupilMat);
      pupil.position.set(side*.31,1.78,1.25);
      model.add(eye,pupil);
      for (const z of [-.52,.52]) {
        const leg=new THREE.Group();
        leg.position.set(side*.29,.83,z);
        const shank=new THREE.Mesh(new THREE.BoxGeometry(.19,.68,.2),hide);
        shank.position.y=-.34;
        const hoof=new THREE.Mesh(new THREE.BoxGeometry(.24,.13,.29),darkHide);
        hoof.position.set(0,-.69,.05);
        leg.add(shank,hoof);
        model.add(leg);
        muleLegs.push(leg);
      }
    }
    const blanket=new THREE.Mesh(new THREE.BoxGeometry(1.08,.08,1.24),new THREE.MeshLambertMaterial({color:0x8b3e32}));
    blanket.position.y=1.51;
    const saddle=new THREE.Mesh(new THREE.BoxGeometry(.78,.17,.9),darkHide);
    saddle.position.y=1.63;
    const pommel=new THREE.Mesh(new THREE.BoxGeometry(.78,.2,.13),packMat);
    pommel.position.set(0,1.76,.39);
    const cantle=pommel.clone();
    cantle.position.z=-.39;
    model.add(blanket,saddle,pommel,cantle);
    for (const side of [-1,1]) {
      for (const z of [-.36,.36]) {
        const strap=new THREE.Mesh(new THREE.BoxGeometry(.08,.73,.1),darkHide);
        strap.position.set(side*.45,1.17,z);
        model.add(strap);
      }
      const bagShell=new THREE.Mesh(new THREE.CylinderGeometry(.36,.31,.57,6,1,true),new THREE.MeshLambertMaterial({color:0x9a7041,side:THREE.DoubleSide}));
      bagShell.scale.set(.78,1,1.35);
      bagShell.position.set(side*.69,1.19,0);
      const bagBottom=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.07,6),packMat);
      bagBottom.scale.set(.78,1,1.35);
      bagBottom.position.set(side*.69,.88,0);
      const bagRim=new THREE.Mesh(new THREE.TorusGeometry(.36,.045,4,6),darkHide);
      bagRim.rotation.x=Math.PI/2;
      bagRim.scale.set(.78,1.35,1);
      bagRim.position.set(side*.69,1.48,0);
      model.add(bagShell,bagBottom,bagRim);
    }
    stonePacks=new THREE.Group();
    for (let i=0;i<6;i++) for (const side of [-1,1]) {
      const stone=new THREE.Mesh(new THREE.DodecahedronGeometry(.17+(i%3)*.015,0),stoneMat);
      stone.position.set(side*(.66+(i%2)*.1),1.48+Math.floor(i/3)*.17,-.31+(i%3)*.31);
      stone.rotation.y=i*.7;
      stonePacks.add(stone);
    }
    stonePacks.visible=false;
    model.add(stonePacks);
    const tail=new THREE.Mesh(new THREE.CylinderGeometry(.04,.09,.7,5),darkHide);
    tail.position.set(0,1.13,-.98);
    tail.rotation.x=.4;
    model.add(tail);
  }
  if (kind==='lumberjack') {
    axe=new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.72,6), wood);
    handle.position.set(.42,.78,.2);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.38,.23,.07), steel);
    blade.position.set(.57,1.07,.2);
    axe.add(handle,blade);
    model.add(axe);
    carriedLogs=new THREE.Group();
    const bark=new THREE.MeshLambertMaterial({color:0x77502d});
    const cutEnd=new THREE.MeshLambertMaterial({color:0xc39b63});
    for (let i=0;i<2;i++) {
      const log=new THREE.Mesh(new THREE.CylinderGeometry(.13,.14,.95,7),[bark,cutEnd,cutEnd]);
      log.rotation.z=Math.PI/2;
      log.position.set(0,.73+i*.23,.56);
      carriedLogs.add(log);
    }
    carriedLogs.visible=false;
    model.add(carriedLogs);
  }
  if (kind==='quarryman') {
    pickaxe=new THREE.Group();
    pickaxe.position.set(.36,.65,.25);
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.8,6),wood);
    handle.position.y=.38;
    const pickHead=new THREE.Group();
    pickHead.rotation.y=Math.PI/2;
    const head=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.58,6),steel);
    head.rotation.z=Math.PI/2;
    head.position.y=.75;
    pickHead.add(head);
    for (const side of [-1,1]) {
      const tip=new THREE.Mesh(new THREE.ConeGeometry(.1,.32,6),steel);
      tip.rotation.z=-side*Math.PI/2;
      tip.position.set(side*.42,.75,0);
      pickHead.add(tip);
    }
    pickaxe.add(handle,pickHead);
    model.add(pickaxe);
    carriedStone=new THREE.Mesh(new THREE.DodecahedronGeometry(.27,0),new THREE.MeshLambertMaterial({color:0xa2a6a0}));
    carriedStone.position.set(0,.74,.54);
    carriedStone.visible=false;
    model.add(carriedStone);
  }
  if (kind==='muleHandler') {
    const leadHandle=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.55,5),wood);
    leadHandle.position.set(.39,.66,.35);
    leadHandle.rotation.x=.45;
    model.add(leadHandle);
  }
  if (kind==='swordsman') {
    const s = new THREE.Mesh(new THREE.BoxGeometry(.07,.07,.9), new THREE.MeshLambertMaterial({color:0xd6d6d6}));
    s.position.set(.38,.8,.3); s.rotation.x=.6; model.add(s);
  }
  if (kind==='archer') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.42,.035,6,18,Math.PI), wood);
    bow.rotation.z = Math.PI/2;
    bow.position.set(.4,.8,.27);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.84,4), steel);
    string.position.set(.4,.8,.27);
    model.add(bow,string);
  }
  g.add(model);
  const bar = new THREE.Group();
  bar.position.y=kind==='mule' ? 2.55 : 2.03;
  const barBack = new THREE.Mesh(new THREE.PlaneGeometry(.94,.14),new THREE.MeshBasicMaterial({color:0x241f1e,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(.88,.09),new THREE.MeshBasicMaterial({color:0x64d967,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  barFill.position.z=.005;
  barBack.renderOrder=10;
  barFill.renderOrder=11;
  bar.add(barBack,barFill);
  g.add(bar);
  let sleepMarker=null;
  if (kind==='lumberjack' || kind==='hunter' || kind==='quarryman') {
    sleepMarker=new THREE.Sprite(new THREE.SpriteMaterial({map:sleepTexture,transparent:true,depthTest:false,depthWrite:false}));
    sleepMarker.position.set(.4,2.9,0);
    sleepMarker.scale.set(1.35,.68,1);
    sleepMarker.visible=false;
    sleepMarker.renderOrder=12;
    g.add(sleepMarker);
  }
  g.position.copy(pos);
  const maxHp = kind==='swordsman' ? 80 : kind==='archer' ? 55 : kind==='mule' ? 70 : 50;
  g.userData = {
    kind, state:'idle', target:null, carrying:0, carryingLog:false, logsAtCamp:0, hp:maxHp, maxHp, alive:true,
    actionTimer:0, home:null, patrolTarget:null, sleeping:false, insideHome:false, attacking:false, mining:false, model, bar, barFill, sleepMarker, carriedLogs, axe, pickaxe, carriedStone, workerHands, stonePacks, muleLegs,
    animationTime:rand(0,6), speed: kind==='swordsman' || kind==='archer' ? 4.1 : kind==='muleHandler' ? 3.8 : kind==='mule' ? 2.4 : 3.2
  };
  addSelectionArrow(g, kind==='mule' ? 2.9 : 2.45);
  scene.add(g);
  npcs.push(g);
  return g;
}

function recruitSoldier(kind, building) {
  if (!building || building.userData.type !== 'barracks') return;
  const cost = recruitCosts[kind];
  if (!canAfford(cost)) return toast('Not enough food');
  pay(cost);
  const npc = makeNPC(kind, spawnPosition(building));
  npc.userData.home = building;
  building.userData.units.push(npc);
  updateSelectionArrows();
  sendPeerAction({kind:'recruit',unit:kind,x:building.position.x,z:building.position.z});
  toast(`${kind} recruited`);
  updateDetails();
}

function setRallyPoint(building, point, replicate=true) {
  const pos = clampToWorld(point.clone(), 3);
  building.userData.rallyPoint = pos;
  if (building.userData.rallyMarker) scene.remove(building.userData.rallyMarker);
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(.75,.91,32), new THREE.MeshBasicMaterial({ color:0xf7d75d, side:THREE.DoubleSide }));
  ring.rotation.x = -Math.PI/2;
  ring.position.y = .04;
  const flag = new THREE.Mesh(new THREE.ConeGeometry(.21,.45,6), new THREE.MeshBasicMaterial({ color:0xf7d75d }));
  flag.position.y = .45;
  marker.add(ring,flag);
  marker.position.set(pos.x,0,pos.z);
  scene.add(marker);
  building.userData.rallyMarker = marker;
  for (const unit of building.userData.units) unit.userData.patrolTarget = null;
  if (replicate) sendPeerAction({kind:'rally',x:building.position.x,z:building.position.z,rallyX:pos.x,rallyZ:pos.z});
  toast('Barracks rally point assigned');
}

function nearestAlive(arr, pos, max=Infinity) {
  let best=null, bd=max;
  for (const o of arr) {
    if (!o.userData.alive || o.userData.insideHome) continue;
    const d=dist2D(o.position,pos);
    if (d<bd) {bd=d; best=o;}
  }
  return best;
}
function availableStorage(kind) {
  const cap=storageCapacity()[kind];
  const workerKind={wood:'lumberjack',food:'hunter',stone:'mule'}[kind];
  const workersWithCargo=npcs.reduce((sum,n) => sum + (n.userData.kind===workerKind ? n.userData.carrying : 0),0);
  return Math.max(0,cap-resources[kind]-workersWithCargo);
}

function killDeerForHunter(animal,hunter) {
  animal.userData.alive=false;
  if (selectedObject===animal) clearSelection();
  animal.userData.selectionArrow.visible=false;
  for (const pupil of animal.userData.pupils) pupil.visible=false;
  for (const cross of animal.userData.crosses) cross.visible=true;
  const index=deer.indexOf(animal);
  if (index>=0) deer.splice(index,1);
  scene.remove(animal);
  animal.position.set(0,1.3,.05);
  animal.rotation.set(0,0,0);
  animal.scale.setScalar(.72);
  hunter.userData.model.add(animal);
  hunter.userData.carcass=animal;
}
function nearestDepot(pos, kind) {
  const candidates = buildings.filter(b => b.userData.stock && b.userData.stock[kind] < buildingStorageCapacity(b, kind));
  let best = null, distance = Infinity;
  for (const b of candidates) {
    const d = dist2D(b.position,pos);
    if (d < distance) { best = b; distance = d; }
  }
  return best;
}
function blockedByBuilding(pos,radius=.35) {
  return buildings.some(b => Math.abs(pos.x-b.position.x)<BUILDING_HALF_SIZE+radius && Math.abs(pos.z-b.position.z)<BUILDING_HALF_SIZE+radius);
}

function segmentClear(from, to, radius) {
  const half = BUILDING_HALF_SIZE + radius - .0001;
  for (const building of buildings) {
    const minX = building.position.x-half, maxX = building.position.x+half;
    const minZ = building.position.z-half, maxZ = building.position.z+half;
    let enter = 0, exit = 1;
    for (const [start, delta, low, high] of [
      [from.x,to.x-from.x,minX,maxX],
      [from.z,to.z-from.z,minZ,maxZ]
    ]) {
      if (Math.abs(delta)<1e-8) {
        if (start<low || start>high) { enter=2; break; }
      } else {
        const a=(low-start)/delta, b=(high-start)/delta;
        enter=Math.max(enter,Math.min(a,b));
        exit=Math.min(exit,Math.max(a,b));
      }
    }
    if (enter<=exit) return false;
  }
  return true;
}

function reachableTarget(obj, target, radius) {
  const half=BUILDING_HALF_SIZE+radius+.15;
  const containing=buildings.find(b => Math.abs(target.x-b.position.x)<half && Math.abs(target.z-b.position.z)<half);
  if (!containing) {
    obj.userData.navApproach=null;
    return { point:target, besideBuilding:false };
  }
  const saved=obj.userData.navApproach;
  if (saved?.building===containing && dist2D(saved.target,target)<.1 && !blockedByBuilding(saved.point,radius+.03)) {
    return { point:saved.point, besideBuilding:true };
  }
  const {x,z}=containing.position;
  const candidates=[
    new THREE.Vector3(x-half,0,z), new THREE.Vector3(x+half,0,z),
    new THREE.Vector3(x,0,z-half), new THREE.Vector3(x,0,z+half)
  ].filter(point => !blockedByBuilding(point,radius+.03));
  candidates.sort((a,b) => dist2D(a,obj.position)-dist2D(b,obj.position));
  const point=candidates[0] || target;
  obj.userData.navApproach={ building:containing, target:target.clone(), point };
  return { point, besideBuilding:true };
}

function routeAroundBuildings(from, goal, radius) {
  const points=[from,goal];
  const half=BUILDING_HALF_SIZE+radius+.15;
  for (const building of buildings) {
    for (const sx of [-1,1]) for (const sz of [-1,1]) {
      const corner=new THREE.Vector3(building.position.x+sx*half,0,building.position.z+sz*half);
      if (!blockedByBuilding(corner,radius+.03)) points.push(corner);
    }
  }
  const distance=Array(points.length).fill(Infinity);
  const previous=Array(points.length).fill(-1);
  const visited=Array(points.length).fill(false);
  distance[0]=0;
  for (let step=0;step<points.length;step++) {
    let current=-1;
    for (let i=0;i<points.length;i++) if (!visited[i] && (current<0 || distance[i]<distance[current])) current=i;
    if (current<0 || !Number.isFinite(distance[current]) || current===1) break;
    visited[current]=true;
    for (let next=1;next<points.length;next++) {
      if (visited[next] || !segmentClear(points[current],points[next],radius)) continue;
      const cost=distance[current]+dist2D(points[current],points[next]);
      if (cost<distance[next]) { distance[next]=cost; previous[next]=current; }
    }
  }
  if (!Number.isFinite(distance[1])) return [];
  const route=[];
  for (let i=1;i>0;i=previous[i]) route.unshift(points[i]);
  return route;
}

function moveToward(obj, target, speed, dt, stop=0.8) {
  const radius=obj.userData.kind === 'mule' ? .65 : obj.userData.kind ? .32 : obj.userData.herd ? .45 : .42;
  const {point:goal,besideBuilding}=reachableTarget(obj,target,radius);
  const arrival=besideBuilding ? .12 : stop;
  const goalDistance=dist2D(obj.position,goal);
  if (goalDistance<=arrival+.04 && (besideBuilding || segmentClear(obj.position,goal,radius))) {
    obj.userData.navPath=null;
    return true;
  }
  let destination=goal;
  let destinationStop=arrival;
  if (segmentClear(obj.position,goal,radius)) {
    obj.userData.navPath=null;
  } else {
    const nav=obj.userData;
    if (!nav.navPath || !nav.navPath.length || !nav.navGoal || dist2D(nav.navGoal,goal)>.2 || nav.navBuildingCount!==buildings.length) {
      nav.navPath=routeAroundBuildings(obj.position,goal,radius);
      nav.navGoal=goal.clone();
      nav.navBuildingCount=buildings.length;
    }
    while (nav.navPath.length>1 && dist2D(obj.position,nav.navPath[0])<.03) nav.navPath.shift();
    if (!nav.navPath.length) return false;
    destination=nav.navPath[0];
    destinationStop=nav.navPath.length>1 ? .01 : arrival;
  }
  const dx=destination.x-obj.position.x, dz=destination.z-obj.position.z;
  const distance=Math.hypot(dx,dz);
  if (distance<=destinationStop+.01) return false;
  const step=Math.min(distance-destinationStop,speed*dt);
  const next=obj.position.clone();
  next.x+=dx/distance*step;
  next.z+=dz/distance*step;
  if (blockedByBuilding(next,radius)) {
    obj.userData.navPath=null;
    return false;
  }
  obj.position.copy(clampToWorld(next,1.2));
  obj.rotation.y=Math.atan2(dx,dz);
  return destination===goal && step>=distance-arrival-.04;
}

function workerRestSpot(worker) {
  const d=worker.userData;
  const radius=d.kind==='mule' ? .65 : .32;
  if (d.restSpot && !blockedByBuilding(d.restSpot,radius)) return d.restSpot;
  const home=d.home.position;
  const offsets=[0,-.7,.7];
  const distance=d.kind==='mule' ? 2.45 : 2.08;
  for (const offset of offsets) {
    for (const [x,z] of [[offset,distance],[distance,offset],[-distance,offset],[offset,-distance]]) {
      const spot=new THREE.Vector3(home.x+x,0,home.z+z);
      if (Math.hypot(spot.x,spot.z)<WORLD_RADIUS-2 && !blockedByBuilding(spot,radius)) {
        d.restSpot=spot;
        return spot;
      }
    }
  }
  d.restSpot=spawnPosition(d.home,radius);
  return d.restSpot;
}

function returnWorkerHome(worker,dt,reason,canSleep=true) {
  const d=worker.userData;
  d.target=null;
  if (d.insideHome && canSleep) {
    d.sleeping=true;
    d.state=`Sleeping inside ${d.home.userData.type}: ${reason}`;
    return;
  }
  if (d.insideHome) wakeWorker(worker);
  const arrived=moveToward(worker,workerRestSpot(worker),d.speed,dt,.2);
  if (arrived && canSleep) {
    d.insideHome=true;
    d.sleeping=true;
    worker.visible=false;
    d.state=`Sleeping inside ${d.home.userData.type}: ${reason}`;
  } else {
    d.sleeping=false;
    d.state=arrived ? `Waiting at ${d.home.userData.type}: ${reason}` : `Returning to ${d.home.userData.type}: ${reason}`;
  }
}

function wakeWorker(worker) {
  const d=worker.userData;
  if (!d.insideHome) return;
  d.insideHome=false;
  d.sleeping=false;
  worker.position.copy(workerRestSpot(worker));
  worker.visible=true;
}

function updateLumberjack(n,dt) {
  const d=n.userData;
  d.sleeping=false;
  if (d.carrying>0) {
    wakeWorker(n);
    const depot = nearestDepot(n.position, 'wood');
    d.state = depot ? `Delivering ${d.carrying} wood to ${depot.userData.type}` : 'Waiting for storage';
    if (!depot) { returnWorkerHome(n,dt,'stockpiles full',false); return; }
    if (moveToward(n,depot.position,d.speed,dt,2.1)) {
      const amount=addResource('wood',d.carrying,depot);
      d.carrying-=amount;
      if (!d.carrying) { d.target=null; d.state='Delivered wood'; }
      else d.state='Waiting for wood storage';
    }
    return;
  }
  if (d.carryingLog) {
    wakeWorker(n);
    d.state=`Taking log to camp (${d.logsAtCamp+1}/${TREE_LOGS})`;
    if (moveToward(n,d.home.position,d.speed,dt,2.1)) {
      d.carryingLog=false;
      d.logsAtCamp++;
      if (d.logsAtCamp>=TREE_LOGS) {
        d.logsAtCamp=0;
        d.carrying=WOOD_PER_BATCH;
        d.state=`Carrying ${WOOD_PER_BATCH} wood to stockpile`;
      }
    }
    return;
  }
  if (availableStorage('wood')<WOOD_PER_BATCH && d.logsAtCamp===0) { returnWorkerHome(n,dt,'stockpiles full'); return; }
  if (!d.target?.userData.alive || dist2D(d.target.position,d.home.position)>WORK_RANGE.lumber) d.target=nearestAlive(trees,d.home.position,WORK_RANGE.lumber);
  if (!d.target) { returnWorkerHome(n,dt,'no trees in range'); return; }
  wakeWorker(n);
  const arrived = moveToward(n,d.target.position,d.speed,dt,1.2);
  d.state = arrived ? 'Chopping a tree' : 'Walking to a tree';
  if (arrived) {
    d.actionTimer += dt;
    if (d.actionTimer > 1.0) {
      d.actionTimer=0;
      d.target.userData.logsRemaining--;
      if (d.target.userData.logsRemaining<=0) {
        d.target.userData.alive=false;
        scene.remove(d.target);
      } else {
        const remaining=d.target.userData.logsRemaining/TREE_LOGS;
        d.target.userData.crown.scale.setScalar(.55+.45*remaining);
      }
      d.carryingLog=true;
      d.target=null;
    }
  }
}

function updateHunter(n,dt) {
  const d=n.userData;
  d.sleeping=false;
  d.attacking=false;
  if (d.carrying>0) {
    wakeWorker(n);
    const depot=nearestDepot(n.position, 'food');
    d.state = depot ? `Delivering ${d.carrying} food to ${depot.userData.type}` : 'Waiting for storage';
    if (!depot) { returnWorkerHome(n,dt,'granaries full',false); return; }
    if (moveToward(n,depot.position,HUNTER_CARRY_SPEED,dt,2.1)) {
      const amount=addResource('food',d.carrying,depot);
      d.carrying-=amount;
      if (!d.carrying) {
        if (d.carcass) { d.model.remove(d.carcass); d.carcass=null; }
        d.target=null; d.state='Delivered food';
      } else d.state='Waiting for food storage';
    }
    return;
  }
  if (availableStorage('food')<MEAT_PER_DEER) { returnWorkerHome(n,dt,'granaries full'); return; }
  if (!d.target?.userData.alive || dist2D(d.target.position,d.home.position)>WORK_RANGE.hunting) d.target=nearestAlive(deer,d.home.position,WORK_RANGE.hunting);
  if (!d.target) { returnWorkerHome(n,dt,'no deer in range'); return; }
  wakeWorker(n);
  const arrived = moveToward(n,d.target.position,d.speed+0.4,dt,.9);
  d.attacking=arrived;
  d.state = arrived ? 'Attacking a deer' : 'Tracking a deer';
  if (arrived) {
    n.rotation.y=Math.atan2(d.target.position.x-n.position.x,d.target.position.z-n.position.z);
    d.actionTimer+=dt;
    if (d.actionTimer>.55) {
      d.actionTimer=0;
      d.target.userData.hp-=10;
      if (d.target.userData.hp<=0) {
        killDeerForHunter(d.target,n);
        d.carrying=MEAT_PER_DEER;
        d.target=null;
      }
    }
  }
}

function updateQuarryman(n,dt) {
  const d=n.userData;
  const home=d.home;
  d.sleeping=false;
  d.mining=false;
  if (d.carrying>0) {
    wakeWorker(n);
    d.state=`Bringing ${d.carrying} stone to the quarry`;
    if (moveToward(n,home.position,d.speed,dt,2.1)) {
      const amount=Math.min(d.carrying,MULE_LOAD-home.userData.stoneBuffer);
      home.userData.stoneBuffer+=amount;
      d.carrying-=amount;
      if (!d.carrying) { d.target=null; d.state='Stone added to quarry pile'; }
    }
    return;
  }
  const reserved=home.userData.units.reduce((total,unit) => total + (unit!==n && unit.userData.kind==='quarryman' && (unit.userData.carrying>0 || unit.userData.target?.userData.alive) ? 8 : 0),0);
  if (home.userData.stoneBuffer+reserved+8>MULE_LOAD) { returnWorkerHome(n,dt,'quarry pile full'); return; }
  if (!d.target?.userData.alive || d.target.userData.deposit!==home.userData.deposit) d.target=nearestAlive(home.userData.deposit.rocks,n.position);
  if (!d.target) { returnWorkerHome(n,dt,'no stone in range'); return; }
  wakeWorker(n);
  const arrived=moveToward(n,d.target.position,d.speed,dt,1.5);
  d.state=arrived ? 'Mining stone' : 'Walking to stone';
  d.mining=arrived;
  if (arrived) {
    d.actionTimer+=dt;
    if (d.actionTimer>=QUARRY_MINING_TIME) {
      d.actionTimer=0;
      d.target.userData.stoneRemaining-=8;
      if (d.target.userData.stoneRemaining<=0) {
        d.target.userData.alive=false;
        scene.remove(d.target);
      } else d.target.scale.setScalar(.55+.45*d.target.userData.stoneRemaining/40);
      d.carrying=8;
      d.target=null;
    }
  } else d.actionTimer=0;
}

function updateMule(n,dt) {
  const d=n.userData;
  const home=d.home;
  const handler=home.userData.handler;
  if (!handler || dist2D(n.position,handler.position)>3.5) {
    d.state=handler ? 'Waiting for handler to catch up' : 'Waiting for a handler';
    return;
  }
  if (d.carrying>0) {
    const depot=nearestDepot(n.position,'stone');
    d.state=depot ? `Hauling ${d.carrying} stone to stockpile` : 'Waiting for stockpile space';
    if (!depot) { moveToward(n,workerRestSpot(n),d.speed,dt,.2); return; }
    if (moveToward(n,depot.position,d.speed,dt,2.2)) {
      d.carrying-=addResource('stone',d.carrying,depot);
      if (!d.carrying) { d.returning=true; d.state='Returning to quarry'; }
    }
    return;
  }
  if (d.returning) {
    d.state='Returning to quarry';
    if (moveToward(n,workerRestSpot(n),d.speed,dt,.2)) d.returning=false;
    return;
  }
  const depleted=home.userData.deposit.rocks.every(rock => !rock.userData.alive);
  const minersCarrying=home.userData.units.some(unit => unit.userData.kind==='quarryman' && unit.userData.carrying>0);
  const ready=home.userData.stoneBuffer>=MULE_LOAD || (depleted && !minersCarrying && home.userData.stoneBuffer>0);
  if (ready && availableStorage('stone')>=home.userData.stoneBuffer) {
    d.carrying=home.userData.stoneBuffer;
    home.userData.stoneBuffer=0;
    d.state=`Loaded ${d.carrying} stone`;
    return;
  }
  d.state=ready ? 'Waiting for stockpile space' : `Waiting at quarry (${home.userData.stoneBuffer}/${MULE_LOAD} stone)`;
  moveToward(n,workerRestSpot(n),d.speed,dt,.2);
}

function updateMuleHandler(n,dt) {
  const d=n.userData;
  const mule=d.home.userData.mule;
  if (!mule) {
    d.state='Waiting for mule';
    moveToward(n,workerRestSpot(n),d.speed,dt,.3);
    return;
  }
  const arrived=moveToward(n,mule.position,d.speed,dt,1.4);
  d.state=mule.userData.carrying>0 ? 'Walking with loaded mule' : mule.userData.returning ? 'Walking back with mule' : arrived ? 'Standing beside mule' : 'Walking to mule';
}

function updateSoldier(n,dt) {
  const d=n.userData;
  const enemy=nearestAlive(raiders,n.position,d.kind==='archer' ? 8 : 2.2);
  if (enemy) {
    d.state=`Fighting a raider`;
    d.actionTimer+=dt;
    if (d.kind==='swordsman') moveToward(n,enemy.position,d.speed,dt,1.05);
    if (d.actionTimer>.85) {
      d.actionTimer=0;
      enemy.userData.hp-=d.kind==='archer' ? 9 : 14;
      if (enemy.userData.hp<=0) { enemy.userData.alive=false; scene.remove(enemy); }
    }
    return;
  }
  const center = d.home?.userData.rallyPoint || d.orphanRally;
  if (!center) {
    d.state='Waiting for a rally point';
    d.sleeping=false;
    return;
  }
  if (!d.patrolTarget || dist2D(n.position,d.patrolTarget)<.55) {
    const angle=rand(0,Math.PI*2), radius=rand(1,4);
    d.patrolTarget=clampToWorld(center.clone().add(new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius)),2);
  }
  d.state='Patrolling rally point';
  moveToward(n,d.patrolTarget,d.speed,dt,.45);
}

function killNPC(n) {
  n.userData.alive=false;
  if (selectedObject===n) clearSelection();
  if (n.userData.home) {
    if (n.userData.kind==='mule') {
      n.userData.home.userData.mule=null;
      n.userData.home.userData.muleRespawn=8;
    }
    if (n.userData.kind==='muleHandler') {
      n.userData.home.userData.handler=null;
      n.userData.home.userData.handlerRespawn=8;
    }
    const units=n.userData.home.userData.units;
    const unitIndex=units.indexOf(n);
    if (unitIndex>=0) units.splice(unitIndex,1);
  }
  scene.remove(n);
  const index=npcs.indexOf(n);
  if (index>=0) npcs.splice(index,1);
  updateSelectionArrows();
}

function updateNPCVisuals(dt) {
  for (const n of npcs) {
    const d=n.userData;
    d.animationTime+=dt;
    const sleepTarget=d.sleeping ? -Math.PI/2 : 0;
    d.model.rotation.z=THREE.MathUtils.damp(d.model.rotation.z,sleepTarget,8,dt);
    d.model.position.y=THREE.MathUtils.damp(d.model.position.y,d.sleeping ? .28+Math.sin(d.animationTime*2)*.025 : 0,8,dt);
    d.bar.quaternion.copy(n.quaternion).invert().multiply(camera.quaternion);
    const fraction=Math.max(0,d.hp/d.maxHp);
    d.barFill.scale.x=fraction;
    d.barFill.position.x=-(1-fraction)*.44;
    d.barFill.material.color.set(fraction>.55 ? 0x64d967 : fraction>.25 ? 0xe7c84e : 0xe35b50);
    if (d.carriedLogs) d.carriedLogs.visible=d.carrying>0 || d.carryingLog;
    if (d.axe) d.axe.visible=d.carrying===0 && !d.carryingLog;
    if (d.pickaxe) {
      d.pickaxe.visible=d.carrying===0;
      d.pickaxe.rotation.x=THREE.MathUtils.damp(d.pickaxe.rotation.x,d.mining ? -.45+Math.sin(d.animationTime*5.5)*.75 : 0,12,dt);
    }
    if (d.carriedStone) d.carriedStone.visible=d.carrying>0;
    if (d.kind==='mule') {
      const moving=d.lastVisualPosition && dist2D(n.position,d.lastVisualPosition)>.002;
      d.lastVisualPosition=n.position.clone();
      d.stonePacks.visible=d.carrying>0;
      const stonesShown=Math.ceil(d.carrying/MULE_LOAD*d.stonePacks.children.length);
      d.stonePacks.children.forEach((stone,index) => stone.visible=index<stonesShown);
      d.muleLegs.forEach((leg,index) => {
        const stride=moving ? Math.sin(d.animationTime*8+(index===0 || index===3 ? 0 : Math.PI))*.36 : 0;
        leg.rotation.x=THREE.MathUtils.damp(leg.rotation.x,stride,12,dt);
      });
      d.model.position.y=moving ? Math.sin(d.animationTime*16)*.025 : 0;
    }
    if (d.kind==='hunter') {
      d.bar.position.y=d.carcass ? 3.05 : 2.03;
      d.selectionArrow.position.y=d.carcass ? 3.4 : 2.45;
    }
    if (d.workerHands.length) {
      const strike=d.attacking ? Math.sin(Math.PI*Math.min(1,d.actionTimer/.55)) : d.mining ? Math.sin(d.animationTime*5.5)*.5+.5 : 0;
      d.workerHands.forEach((hand,index) => {
        const side=index===0 ? -1 : 1;
        const carryingLogs=d.kind==='lumberjack' && (d.carrying>0 || d.carryingLog);
        const carryingDeer=d.kind==='hunter' && !!d.carcass;
        const x=side*(carryingLogs ? .43 : carryingDeer ? .28 : .32);
        const y=carryingDeer ? 1.72 : carryingLogs ? .76 : .65+(index===1 ? .18 : .05)*strike;
        const z=carryingDeer ? .15 : carryingLogs ? .56 : .25+(index===1 ? .55 : .15)*strike;
        hand.position.x=THREE.MathUtils.damp(hand.position.x,x,15,dt);
        hand.position.y=THREE.MathUtils.damp(hand.position.y,y,15,dt);
        hand.position.z=THREE.MathUtils.damp(hand.position.z,z,15,dt);
      });
      if (d.pickaxe && d.kind==='quarryman') d.pickaxe.position.copy(d.workerHands[1].position);
    }
    if (d.sleepMarker) {
      d.sleepMarker.visible=d.sleeping && !d.insideHome;
      if (d.sleepMarker.visible) {
        d.sleepMarker.position.y=2.9+Math.sin(d.animationTime*2)*.14;
        d.sleepMarker.position.x=.4+Math.sin(d.animationTime)*.12;
        d.sleepMarker.material.opacity=.75+.2*Math.sin(d.animationTime*2.4);
      }
    }
  }
  for (const building of buildings) {
    const sign=building.userData.sleepingSign;
    if (!sign) continue;
    sign.visible=building.userData.units.some(unit => unit.userData.insideHome);
    if (sign.visible) sign.position.y=5.2+Math.sin(clock.elapsedTime*2)*.12;
  }
  for (const quarry of buildings) {
    const lead=quarry.userData.muleLead;
    if (!lead) continue;
    const mule=quarry.userData.mule, handler=quarry.userData.handler;
    lead.visible=!!(mule && handler && dist2D(mule.position,handler.position)<4);
    if (!lead.visible) continue;
    const points=lead.geometry.attributes.position;
    points.setXYZ(0,handler.position.x,1.05,handler.position.z);
    points.setXYZ(1,mule.position.x+Math.sin(mule.rotation.y)*1.25,1.55,mule.position.z+Math.cos(mule.rotation.y)*1.25);
    points.needsUpdate=true;
  }
}

function updateNPCs(dt) {
  for (const building of buildings) {
    if (building.userData.type!=='quarry') continue;
    if (!building.userData.mule && (building.userData.muleRespawn-=dt)<=0) {
      const mule=makeNPC('mule',spawnPosition(building,.65));
      mule.userData.home=building;
      building.userData.mule=mule;
      building.userData.units.push(mule);
    }
    if (!building.userData.handler && (building.userData.handlerRespawn-=dt)<=0) {
      const handler=makeNPC('muleHandler',spawnPosition(building));
      handler.userData.home=building;
      building.userData.handler=handler;
      building.userData.units.push(handler);
    }
  }
  for (const n of npcs) {
    if (n.userData.kind==='lumberjack') updateLumberjack(n,dt);
    if (n.userData.kind==='hunter') updateHunter(n,dt);
    if (n.userData.kind==='quarryman') updateQuarryman(n,dt);
    if (n.userData.kind==='mule') updateMule(n,dt);
    if (n.userData.kind==='muleHandler') updateMuleHandler(n,dt);
    if (n.userData.kind==='swordsman' || n.userData.kind==='archer') updateSoldier(n,dt);
  }
}

function updateWildlife(dt) {
  for (const herd of herds) {
    const members=herd.members.filter(d => d.userData.alive);
    if (!members.length) continue;
    const leader=members[0];
    herd.turnIn-=dt;
    if (herd.turnIn<=0 || !herd.wanderTarget || dist2D(leader.position,herd.wanderTarget)<.5) {
      herd.turnIn=rand(3,6);
      herd.heading+=rand(-.7,.7);
      herd.wanderTarget=clampToWorld(leader.position.clone().add(new THREE.Vector3(Math.sin(herd.heading)*8,0,Math.cos(herd.heading)*8)),3);
    }
    moveToward(leader,herd.wanderTarget,.95,dt,.3);
    herd.heading=leader.rotation.y;
    for (const animal of members.slice(1)) {
      const offset=animal.userData.offset.clone().applyAxisAngle(new THREE.Vector3(0,1,0),herd.heading);
      const goal=clampToWorld(leader.position.clone().add(offset),2.5);
      moveToward(animal,goal,1.35,dt,.25);
    }
    for (const animal of members) {
      animal.userData.gait+=dt*6;
      animal.userData.legs.forEach((leg,i) => leg.rotation.x=Math.sin(animal.userData.gait+(i===0 || i===3 ? 0 : Math.PI))*.32);
    }
  }
  for (let i=herds.length-1;i>=0;i--) {
    if (herds[i].members.every(animal => !animal.userData.alive)) herds.splice(i,1);
  }

  for (const r of raiders) {
    if (!r.userData.alive) continue;
    r.userData.turnIn -= dt;
    const victim=nearestAlive(npcs,r.position,7);
    if (victim) {
      if (moveToward(r,victim.position,2.3,dt,1.05)) {
        r.userData.attackTimer+=dt;
        if (r.userData.attackTimer>.9) {
          r.userData.attackTimer=0;
          victim.userData.hp-=8;
          if (victim.userData.hp<=0) killNPC(victim);
        }
      }
      continue;
    }
    const pd=dist2D(r.position,camera.position);
    if (pd<9) {
      moveToward(r,camera.position,2.4,dt,1.4);
    } else {
      if (r.userData.turnIn<=0 || !r.userData.wanderTarget || dist2D(r.position,r.userData.wanderTarget)<.5) {
        r.userData.turnIn=rand(1,3);
        r.userData.dir += rand(-1.6,1.6);
        r.userData.wanderTarget=clampToWorld(r.position.clone().add(new THREE.Vector3(Math.sin(r.userData.dir)*6,0,Math.cos(r.userData.dir)*6)),2);
      }
      moveToward(r,r.userData.wanderTarget,1,dt,.3);
      r.userData.dir=r.rotation.y;
    }
  }
}

function collidesBuilding(pos) {
  return blockedByBuilding(pos,PLAYER_RADIUS);
}

function updatePlayer(dt) {
  if (!controls.isLocked) return;
  const forwardInput=Number(!!keys.KeyW)-Number(!!keys.KeyS);
  const sideInput=Number(!!keys.KeyD)-Number(!!keys.KeyA);
  if (forwardInput || sideInput) {
    const forward=new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y=0;
    forward.normalize();
    const right=forward.clone().cross(new THREE.Vector3(0,1,0));
    const movement=forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput)).normalize();
    const sprinting=keys.ShiftLeft || keys.ShiftRight;
    const distance=WALK_SPEED*(sprinting ? SPRINT_MULTIPLIER : 1)*dt;
    const canMoveTo=pos => Math.hypot(pos.x,pos.z)<WORLD_RADIUS-1.1 && !collidesBuilding(pos);
    const xStep=camera.position.clone();
    xStep.x+=movement.x*distance;
    if (canMoveTo(xStep)) camera.position.x=xStep.x;
    const zStep=camera.position.clone();
    zStep.z+=movement.z*distance;
    if (canMoveTo(zStep)) camera.position.z=zStep.z;
  }

  if (jumpRequested && grounded) {
    verticalVelocity=JUMP_SPEED;
    grounded=false;
  }
  jumpRequested=false;
  if (!grounded) {
    verticalVelocity-=GRAVITY*dt;
    camera.position.y+=verticalVelocity*dt;
    if (camera.position.y<=EYE_HEIGHT) {
      camera.position.y=EYE_HEIGHT;
      verticalVelocity=0;
      grounded=true;
    }
  }
}

function swordAttack() {
  const origin=camera.position.clone();
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  let best=null, bestScore=999;
  for (const r of raiders) {
    if (!r.userData.alive) continue;
    const to=r.position.clone().sub(origin);
    const dist=to.length();
    if (dist>3.0) continue;
    to.normalize();
    const angle=dir.angleTo(to);
    if (angle<.65 && dist<bestScore) {best=r; bestScore=dist;}
  }
  if (best) {
    best.userData.hp-=20;
    if (best.userData.hp<=0) {best.userData.alive=false; scene.remove(best);}
    toast('Sword hit');
  }
}

function selectionBuilding() {
  if (!selectedObject) return null;
  if (selectedObject.userData.type) return selectedObject;
  return selectedObject.userData.home;
}

function updateSelectionArrows() {
  for (const obj of [...buildings, ...npcs, ...deer]) obj.userData.selectionArrow.visible = false;
  for (const b of buildings) if (b.userData.rangeIndicator) b.userData.rangeIndicator.visible=false;
  if (!selectedObject) return;
  selectedObject.userData.selectionArrow.visible = true;
  const building = selectionBuilding();
  if (building) {
    building.userData.selectionArrow.visible = true;
    for (const unit of building.userData.units) unit.userData.selectionArrow.visible = true;
    if (selectedObject===building && building.userData.rangeIndicator) building.userData.rangeIndicator.visible=true;
  }
}

function demolishSelectedBuilding(target=selectedObject, replicate=true) {
  const b=target?.userData.type ? target : null;
  if (!b || b.userData.type==='house') return toast('Select an outpost to dismantle');
  const refund=Object.fromEntries(Object.entries(costs[b.userData.type]).map(([kind,amount]) => [kind,Math.floor(amount/2)]));
  const contents=b.userData.stock ? { ...b.userData.stock } : b.userData.type==='quarry'
    ? {wood:0,food:0,stone:b.userData.stoneBuffer+b.userData.units.reduce((total,unit) => total+unit.userData.carrying,0)} : null;
  if (contents && RESOURCE_KINDS.some(kind => buildings.reduce((room,other) => other !== b && other.userData.stock ? room + buildingStorageCapacity(other,kind) - other.userData.stock[kind] : room,0) < contents[kind])) {
    return toast('Build another store before dismantling this one');
  }
  if (replicate) sendPeerAction({kind:'demolish',x:b.position.x,z:b.position.z});
  for (const unit of [...b.userData.units]) {
    if (b.userData.type==='barracks') {
      unit.userData.orphanRally=b.userData.rallyPoint?.clone() || b.position.clone();
      unit.userData.home=null;
    } else killNPC(unit);
  }
  if (b.userData.rallyMarker) scene.remove(b.userData.rallyMarker);
  if (b.userData.rangeIndicator) scene.remove(b.userData.rangeIndicator);
  if (b.userData.muleLead) scene.remove(b.userData.muleLead);
  if (b.userData.deposit) b.userData.deposit.quarry=null;
  scene.remove(b);
  buildings.splice(buildings.indexOf(b),1);
  if (b===selectedObject) clearSelection();
  if (contents) {
    for (const kind of RESOURCE_KINDS) addResource(kind,contents[kind]);
  }
  const refunded=Object.entries(refund).map(([kind,amount]) => `${addResource(kind,amount)} ${kind}`).filter(label => !label.startsWith('0 '));
  updateStorageVisuals();
  toast(`Outpost dismantled${refunded.length ? `: +${refunded.join(', ')}` : ''}`);
}

function clearSelection() {
  if (!selectedObject) return;
  selectedObject = null;
  detailsEl.hidden = true;
  detailActions.replaceChildren();
  updateSelectionArrows();
}

function updateDetails() {
  if (!selectedObject || detailsEl.hidden) return;
  const b = selectedObject.userData.type ? selectedObject : null;
  if (b) {
    const type = b.userData.type;
    detailTitle.textContent = { house:'Base House', stockpile:'Stockpile', granary:'Granary', lumber:'Lumber Camp', hunting:'Hunting Lodge', barracks:'Barracks', quarry:'Quarry' }[type];
    if (type === 'barracks') {
      const rally = b.userData.rallyPoint;
      detailBody.textContent = `Troops: ${b.userData.units.length}\nRally: ${rally ? `${Math.round(rally.x)}, ${Math.round(rally.z)}` : 'not assigned'}\nLook at the ground and press Q to set the rally point.`;
    } else if (type === 'quarry') {
      const miners=b.userData.units.filter(unit => unit.userData.kind==='quarryman');
      const mule=b.userData.mule;
      const handler=b.userData.handler;
      detailBody.textContent=`Work range: ${WORK_RANGE.quarry} m\nMiners: ${miners.length} · ${QUARRY_MINING_TIME}s per load\nStone at quarry: ${b.userData.stoneBuffer} / ${MULE_LOAD}\nMule: ${mule ? `${mule.userData.state}${mule.userData.carrying ? ` (${mule.userData.carrying} stone)` : ''}` : 'Returning soon'}\nHandler: ${handler?.userData.state || 'Returning soon'}\n${miners.map((miner,index) => `Miner ${index+1}: ${miner.userData.state}`).join('\n')}`;
    } else if (type === 'lumber' || type === 'hunting') {
      const worker = b.userData.units[0];
      const workerName={lumber:'Lumberjack',hunting:'Hunter'}[type];
      const resource={lumber:'wood',hunting:'food'}[type];
      detailBody.textContent = `Work range: ${WORK_RANGE[type]} m\nWorkers: ${b.userData.units.length}\n${worker ? `${workerName}: ${worker.userData.state}\nCarrying: ${worker.userData.carryingLog ? '1 log' : `${worker.userData.carrying} ${resource}`}` : 'Worker lost'}`;
    } else {
      detailBody.textContent = type === 'stockpile'
        ? `This stockpile:\nWood: ${b.userData.stock.wood} / ${STOCKPILE_CAPACITY.wood}\nStone: ${b.userData.stock.stone} / ${STOCKPILE_CAPACITY.stone}`
        : type === 'granary'
          ? `This granary:\nFood: ${b.userData.stock.food} / ${GRANARY_CAPACITY.food}`
          : 'The settlement headquarters.';
    }
  } else {
    const d = selectedObject.userData;
    if (deer.includes(selectedObject)) {
      detailTitle.textContent='Deer';
      detailBody.textContent=`Health: ${Math.max(0,Math.ceil(d.hp))} / 18\nDoing: Roaming with its herd`;
    } else {
      detailTitle.textContent = d.kind==='muleHandler' ? 'Mule Handler' : d.kind[0].toUpperCase() + d.kind.slice(1);
      const resource={lumberjack:'wood',hunter:'food',quarryman:'stone',mule:'stone'}[d.kind];
      detailBody.textContent = `Health: ${Math.max(0,Math.ceil(d.hp))} / ${d.maxHp}\nDoing: ${d.state}${resource ? `\nCarrying: ${d.carryingLog ? '1 log' : `${d.carrying} ${resource}`}` : ''}`;
    }
  }
}

function selectObject(obj) {
  selectedObject = obj;
  updateSelectionArrows();
  detailActions.replaceChildren();
  if (obj.userData.type === 'barracks') {
    detailActions.textContent = 'R: swordsman · 10 food\nT: archer · 12 food';
  }
  if (obj.userData.type && obj.userData.type !== 'house') {
    const refund=Object.entries(costs[obj.userData.type]).map(([kind,amount]) => `${Math.floor(amount/2)} ${kind}`).filter(label => !label.startsWith('0 '));
    detailActions.textContent += `${detailActions.textContent ? '\n' : ''}X: dismantle${refund.length ? ` · +${refund.join(', ')}` : ''}`;
  }
  detailsEl.hidden = false;
  updateDetails();
}

function aimedSelectable() {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  ray.far = 18;
  for (const hit of ray.intersectObjects([...buildings,...npcs.filter(n => !n.userData.insideHome),...deer],true)) {
    let obj = hit.object;
    while (obj && !buildings.includes(obj) && !npcs.includes(obj) && !deer.includes(obj)) obj = obj.parent;
    if (obj) return obj;
  }
  return null;
}

document.addEventListener('keydown', e => {
  keys[e.code]=true;
  if (e.code==='Space' && controls.isLocked) {
    e.preventDefault();
    if (!e.repeat) jumpRequested=true;
  }
  if (e.code==='Tab' && controls.isLocked) {
    e.preventDefault();
    if (!e.repeat) inventoryEl.hidden = !inventoryEl.hidden;
    return;
  }
  if (e.code==='Escape') {
    cancelBuild();
    clearSelection();
    if (uiMode === 'buildMenu') {
      buildMenu.hidden = true;
      uiMode = 'main';
      startEl.style.display = 'flex';
    }
    return;
  }
  if (e.code==='KeyE' && !e.repeat) {
    if (uiMode === 'buildMenu') closeBuildMenu();
    else if (controls.isLocked) openBuildMenu();
    return;
  }
  if (uiMode==='buildMenu' && !e.repeat) {
    const index={Digit1:0,Digit2:1,Digit3:2,Digit4:3,Digit5:4,Digit6:5}[e.code];
    if (index !== undefined) {
      selectBuilding(buildingChoices[index][0]);
      closeBuildMenu();
      return;
    }
  }
  if (!controls.isLocked) return;
  if (e.code==='KeyX' && !e.repeat) { demolishSelectedBuilding(); return; }
  const barracks = selectionBuilding();
  if (barracks?.userData.type === 'barracks' && !e.repeat) {
    if (e.code==='KeyR') recruitSoldier('swordsman',barracks);
    if (e.code==='KeyT') recruitSoldier('archer',barracks);
  }
  if (e.code==='KeyQ' && !e.repeat) {
    if (!barracks || barracks.userData.type !== 'barracks') return toast('Select a barracks first');
    const point = getAimGroundPoint();
    if (!point) return toast('Look at nearby ground to set rally point');
    setRallyPoint(barracks,point);
  }
});
document.addEventListener('keyup', e => keys[e.code]=false);
addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code]=false;
  jumpRequested=false;
});

document.addEventListener('mousedown', e => {
  if (!controls.isLocked) return;
  if (e.button===0) {
    if (selectedBuild) placeBuilding();
    else {
      const target = aimedSelectable();
      if (target) selectObject(target);
      else {
        clearSelection();
        swordAttack();
      }
    }
  }
  if (e.button===2) cancelBuild();
});
document.addEventListener('contextmenu', e => e.preventDefault());

function updateHUD() {
  const capacity=storageCapacity();
  const counts = {
    lumberjack:npcs.filter(n=>n.userData.kind==='lumberjack').length,
    hunter:npcs.filter(n=>n.userData.kind==='hunter').length,
    quarryman:npcs.filter(n=>n.userData.kind==='quarryman').length,
    mule:npcs.filter(n=>n.userData.kind==='mule').length,
    muleHandler:npcs.filter(n=>n.userData.kind==='muleHandler').length,
    swordsman:npcs.filter(n=>n.userData.kind==='swordsman').length,
    archer:npcs.filter(n=>n.userData.kind==='archer').length
  };
  statsEl.innerHTML = `
    ${multiplayer.roomCode ? `<b>Online:</b> ${multiplayer.roomCode} · ${multiplayer.status}<br>` : ''}
    <b>Enemies:</b> ${enemiesEnabled ? 'on' : 'off'}<br>
    <b>Build:</b> ${selectedBuild ?? 'none'}<br>
    <span style="color:#bbb">E Buildings · Tab Stores</span>
  `;
  if (!inventoryEl.hidden) {
    const countBuilding = type => buildings.filter(b => b.userData.type === type).length;
    const row = (label,value) => `<div class="inventoryRow"><span>${label}</span><strong>${value}</strong></div>`;
    inventoryContents.innerHTML = `
      ${row('🪵 Wood',`${Math.floor(resources.wood)} / ${capacity.wood}`)}
      ${row('🍖 Food',`${Math.floor(resources.food)} / ${capacity.food}`)}
      ${row('🪨 Stone',`${Math.floor(resources.stone)} / ${capacity.stone}`)}
      <h3>People</h3>
      ${row('Lumberjacks',counts.lumberjack)}
      ${row('Hunters',counts.hunter)}
      ${row('Quarrymen',counts.quarryman)}
      ${row('Mules',counts.mule)}
      ${row('Mule Handlers',counts.muleHandler)}
      ${row('Swordsmen',counts.swordsman)}
      ${row('Archers',counts.archer)}
      <h3>Buildings</h3>
      ${row('Houses',countBuilding('house'))}
      ${row('Stockpiles',countBuilding('stockpile'))}
      ${row('Granaries',countBuilding('granary'))}
      ${row('Lumber Camps',countBuilding('lumber'))}
      ${row('Hunting Lodges',countBuilding('hunting'))}
      ${row('Quarries',countBuilding('quarry'))}
      ${row('Barracks',countBuilding('barracks'))}
    `;
  }
}

function drawMinimap() {
  const ctx = minimapContext;
  const center = minimapCanvas.width / 2;
  const radius = center - 5;
  const scale = radius / WORLD_RADIUS;
  const point = pos => [center + pos.x * scale, center + pos.z * scale];
  const dot = (pos, size, color) => {
    const [x,y] = point(pos);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x,y,size,0,Math.PI*2);
    ctx.fill();
  };

  ctx.clearRect(0,0,minimapCanvas.width,minimapCanvas.height);
  ctx.beginPath();
  ctx.arc(center,center,radius,0,Math.PI*2);
  ctx.fillStyle = '#587848';
  ctx.fill();
  ctx.save();
  ctx.clip();

  for (const deposit of stoneDeposits) dot(deposit.position,6,'#757d77');
  for (const tree of trees) if (tree.userData.alive) dot(tree.position,1.8,'#244f2c');
  for (const rock of rocks) if (rock.userData.alive) dot(rock.position,2,'#a6aba6');
  for (const animal of deer) if (animal.userData.alive) dot(animal.position,2,'#b48b5c');
  if (selectedObject?.userData.type && WORK_RANGE[selectedObject.userData.type]) {
    const [x,y]=point(selectedObject.position);
    ctx.strokeStyle='#f6db70';
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.arc(x,y,WORK_RANGE[selectedObject.userData.type]*scale,0,Math.PI*2);
    ctx.stroke();
  }
  const buildingColors = { house:'#f3e0ad', stockpile:'#b59861', granary:'#d6bd78', lumber:'#9b7148', hunting:'#719861', barracks:'#b9bec3', quarry:'#979d9f' };
  for (const building of buildings) {
    const [x,y] = point(building.position);
    ctx.fillStyle = buildingColors[building.userData.type];
    ctx.fillRect(x-3.5,y-3.5,7,7);
    if (building.userData.rallyPoint) {
      const [rx,ry] = point(building.userData.rallyPoint);
      ctx.strokeStyle = '#f7d75d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx,ry,5,0,Math.PI*2);
      ctx.stroke();
    }
  }
  for (const unit of npcs) if (!unit.userData.insideHome) dot(unit.position,2.6,'#67dcff');
  for (const enemy of raiders) if (enemy.userData.alive) dot(enemy.position,3,'#ed5959');

  if (selectedObject) {
    const [x,y] = point(selectedObject.position);
    ctx.strokeStyle = '#ffdd58';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x,y,7,0,Math.PI*2);
    ctx.stroke();
  }

  if (multiplayer.remote) dot(multiplayer.remote.position,3.2,'#f4d87a');

  const [px,py] = point(camera.position);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const len = Math.hypot(direction.x,direction.z) || 1;
  const dx = direction.x/len, dy = direction.z/len;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#203021';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px+dx*9,py+dy*9);
  ctx.lineTo(px-dx*5-dy*4,py-dy*5+dx*4);
  ctx.lineTo(px-dx*5+dy*4,py-dy*5-dx*4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#d0b879';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center,center,radius,0,Math.PI*2);
  ctx.stroke();
}

createBuilding('house',-2*GRID,-2*GRID);
createBuilding('stockpile',-GRID,-2*GRID);
createBuilding('granary',0,-2*GRID);
addResource('wood',120);
addResource('food',35);
addResource('stone',30);
drawMinimap();

let minimapElapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  updatePlayer(dt);
  const channel=multiplayer.channel;
  if (channel?.readyState==='open' && performance.now()-multiplayer.lastPositionSent>=50) {
    multiplayer.lastPositionSent=performance.now();
    const direction=new THREE.Vector3();
    camera.getWorldDirection(direction);
    channel.send(JSON.stringify({type:'position',name:multiplayer.name,x:camera.position.x,z:camera.position.z,yaw:Math.atan2(direction.x,direction.z)}));
  }
  updateGhost();
  updateNPCs(dt);
  updateWildlife(dt);
  updateNPCVisuals(dt);
  deerSpawnTimer+=dt;
  if (deerSpawnTimer>=28 && uiMode!=='main') {
    deerSpawnTimer=0;
    if (deer.length<60) spawnHerd(true);
  }
  if (enemiesEnabled && uiMode !== 'main') {
    enemySpawnTimer += dt;
    if (enemySpawnTimer >= 12) {
      enemySpawnTimer = 0;
      if (raiders.filter(r => r.userData.alive).length < 7) makeRaider(randomPointInCircle(24,WORLD_RADIUS-6));
    }
  }
  updateDetails();
  updateHUD();
  updateStorageVisuals();
  minimapElapsed += dt;
  if (minimapElapsed >= .1) {
    minimapElapsed = 0;
    drawMinimap();
  }
  renderer.render(scene,camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
