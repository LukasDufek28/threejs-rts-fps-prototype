import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { playSound } from './audio.js';
import {PRESETS, ARMOURY_ITEMS, BUILDINGS, BUILDING_HELP, FOOD, MAP_CELLS, MARKET_PRICES, MATCH_PHASES, POPULARITY, RATIONS, RECIPES, RECIPE_OPTIONS, RESOURCES, STOCKPILE_ITEMS, STORAGE_CAPACITY, TAXES, TILE_SIZE, UNITS, WORKER_CYCLES, WORLD_RADIUS} from './config/balance.js';
import {nearestUnclaimedTarget, targetClaimedByAnother} from './world/WorkerTargets.js';
import {LogicalGrid} from './world/Grid.js';
import {SpatialHash} from './world/SpatialHash.js';
import {zoneAt} from './simulation/ZoneMath.js';
import {footprintInSector, startingBaseInSector} from './simulation/BaseSectors.js';

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
scene.fog = new THREE.Fog(0x87b7d8, 110, 370);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 440);
camera.position.set(0, 2.0, 0);
scene.add(camera);
const viewScene=new THREE.Scene();
viewScene.add(new THREE.HemisphereLight(0xe9f6ff,0x6b4228,2.5));
const viewCamera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.01,10);
viewScene.add(viewCamera);
const royalHand=new THREE.Group();
royalHand.position.set(.72,-.62,-1.28);
royalHand.rotation.z=-.35;
royalHand.scale.setScalar(.65);
const blueSteel=new THREE.MeshStandardMaterial({color:0xc4d4dc,metalness:.8,roughness:.23});
const edgeSteel=new THREE.MeshStandardMaterial({color:0xf2f6ef,metalness:.76,roughness:.15});
const goldTrim=new THREE.MeshStandardMaterial({color:0xd6aa4d,metalness:.65,roughness:.27});
const gripMat=new THREE.MeshStandardMaterial({color:0x3b241d,roughness:.88});
const sleeve=new THREE.Mesh(new THREE.CylinderGeometry(.17,.24,.6,8),new THREE.MeshStandardMaterial({color:0x315b88,roughness:.85}));
sleeve.position.set(.17,-.3,.1);
sleeve.rotation.z=.35;
const glove=new THREE.Mesh(new THREE.BoxGeometry(.22,.2,.25),new THREE.MeshStandardMaterial({color:0x5b3726,roughness:.8}));
glove.position.set(.02,-.06,-.03);
const hilt=new THREE.Mesh(new THREE.CylinderGeometry(.046,.05,.38,8),gripMat);
hilt.position.y=.04;
const pommel=new THREE.Mesh(new THREE.SphereGeometry(.095,10,8),goldTrim);
pommel.position.y=-.19;
const guard=new THREE.Mesh(new THREE.BoxGeometry(.5,.075,.12),goldTrim);
guard.position.y=.27;
const guardEnds=[];
for (const side of [-1,1]) {
  const end=new THREE.Mesh(new THREE.SphereGeometry(.067,8,6),goldTrim);
  end.position.set(side*.26,.28,0);
  guardEnds.push(end);
}
const bladeShape=new THREE.Shape();
bladeShape.moveTo(-.105,.31);
bladeShape.lineTo(.105,.31);
bladeShape.lineTo(.085,1.07);
bladeShape.lineTo(0,1.27);
bladeShape.lineTo(-.085,1.07);
bladeShape.closePath();
const blade=new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape,{depth:.055,bevelEnabled:true,bevelThickness:.012,bevelSize:.01,bevelSegments:1}),blueSteel);
blade.position.z=-.03;
const fuller=new THREE.Mesh(new THREE.BoxGeometry(.023,.52,.007),edgeSteel);
fuller.position.set(0,.69,.045);
const jewel=new THREE.Mesh(new THREE.OctahedronGeometry(.065),new THREE.MeshStandardMaterial({color:0xa8232b,metalness:.25,roughness:.2}));
jewel.position.set(0,.26,.08);
royalHand.add(sleeve,glove,hilt,pommel,guard,...guardEnds,blade,fuller,jewel);
viewCamera.add(royalHand);
let swordSwingTime=0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const benchmark = new URLSearchParams(location.search).has('bench') ? {frames:0,cpuMs:0,averageCpuMs:0,mainDrawCalls:0,basePlaced:false} : null;
if(benchmark)window.__gameBenchmark=benchmark;

const controls = new PointerLockControls(camera, document.body);
const playBtn = document.querySelector('#playBtn');
const enterMatchBtn = document.querySelector('#enterMatchBtn');
const quickMatchBtn = document.querySelector('#quickMatchBtn');
const createRoomBtn = document.querySelector('#createRoomBtn');
const joinRoomBtn = document.querySelector('#joinRoomBtn');
const playerNameInput = document.querySelector('#playerName');
const balancePresetSelect=document.querySelector('#balancePreset');
let ACTIVE_PRESET=PRESETS[localStorage.getItem('rts-balance-preset')]||PRESETS.BATTLE_ROYALE;
balancePresetSelect.value=localStorage.getItem('rts-balance-preset')||'BATTLE_ROYALE';
balancePresetSelect.addEventListener('change',()=>{localStorage.setItem('rts-balance-preset',balancePresetSelect.value);ACTIVE_PRESET=PRESETS[balancePresetSelect.value];});
const roomCodeInput = document.querySelector('#roomCode');
const onlineStatus = document.querySelector('#onlineStatus');
const startEl = document.querySelector('#start');
const resumeBtn = document.querySelector('#resumeBtn');
const outcomeEl = document.querySelector('#outcome');
const outcomeTitle = document.querySelector('#outcomeTitle');
const outcomePlace = document.querySelector('#outcomePlace');
document.querySelector('#outcomeMenu').addEventListener('click',() => location.reload());
const detailsEl = document.querySelector('#details');
const detailTitle = document.querySelector('#detailTitle');
const detailBody = document.querySelector('#detailBody');
const detailActions = document.querySelector('#detailActions');
const buildMenu = document.querySelector('#buildMenu');
const buildOptions = document.querySelector('#buildOptions');
const buildTooltip = document.querySelector('#buildTooltip');
const commandMenu=document.querySelector('#commandMenu');
const inventoryEl = document.querySelector('#inventory');
const inventoryContents = document.querySelector('#inventoryContents');
const minimapCanvas = document.querySelector('#minimapCanvas');
const minimapContext = minimapCanvas.getContext('2d');
const healthFill = document.querySelector('#healthFill');
const healthValue = document.querySelector('#healthValue');
const staminaFill = document.querySelector('#staminaFill');
const staminaValue = document.querySelector('#staminaValue');
const basePrompt = document.querySelector('#basePrompt');
let uiMode = 'main';
let fallbackLook = false;
const canPlay = () => controls.isLocked || (fallbackLook && uiMode==='game');
let selectedObject = null;
let allMilitarySelected=false;
let playerHealth = 100;
let playerStamina = 100;
let sprintExhausted = false;
let basePlaced = false;
let gameStarted = false;
let sandboxMode = false;
let baseSpawn = new THREE.Vector3();
let matchEnded = false;
let playerReady = false;
let lastSwordAttack = 0;
const multiplayer = {
  socket:null, roomCode:'', playerId:'', peers:new Map(), name:'', isHost:false,
  lastPositionSent:0, lastUnitsSent:0, status:'Offline'
};

function activePeers() { return [...multiplayer.peers.values()].filter(peer => peer.alive); }
function combatReady() { return basePlaced && playerReady && activePeers().some(peer => peer.ready) && !matchEnded; }
function setStartPosition(spawn) {
  baseSpawn.set(spawn.x,0,spawn.z);
  camera.position.set(spawn.x,EYE_HEIGHT,spawn.z);
  let yaw=Math.atan2(spawn.x,spawn.z);
  for(let i=0;i<32;i++) {
    const angle=Math.atan2(-spawn.z,-spawn.x)+(i-16)*Math.PI/32;
    const x=Math.round((spawn.x+Math.cos(angle)*12)/GRID)*GRID,z=Math.round((spawn.z+Math.sin(angle)*12)/GRID)*GRID;
    if(isBuildingSpotFree(x,z,'house')&&findStarterStores(x,z)) {yaw=Math.atan2(spawn.x-x,spawn.z-z);break;}
  }
  camera.rotation.set(-.18,yaw,0,'YXZ');
  verticalVelocity=0;
  grounded=true;
}
function updateBasePrompt() {
  basePrompt.textContent=sandboxMode ? 'Sandbox: place your base on any clear ground. Walk to the area you want, look at the ground, and click.' : `Place your base inside your highlighted ${multiplayer.sectorCount===2?'half':'sector'} of the map. Walk to clear ground, look at it, and click.`;
}
function beginBasePlacement() {
  if (basePlaced) return;
  selectedBuild='house';
  if (buildGhost) scene.remove(buildGhost);
  buildGhost=makeBuildingMesh('house',true);
  scene.add(buildGhost);
  basePrompt.hidden=false;
  updateBasePrompt();
  toast(sandboxMode ? 'Choose any clear location for your base' : 'Place your base inside your highlighted map sector');
}

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

function restartForNewGame(mode,roomCode='') {
  if (!basePlaced) return false;
  sessionStorage.setItem('rts-new-game',JSON.stringify({mode,roomCode,name:playerNameInput.value}));
  location.reload();
  return true;
}

function beginSolo() {
  if (!currentPlayerName()) return;
  if (restartForNewGame('solo')) return;
  closeMultiplayer();
  gameStarted=true;
  resumeBtn.hidden=false;
  playBtn.textContent='New sandbox';
  sandboxMode=true;
  zoneRing.visible=false;
  playerHealth=100;
  playerStamina=100;
  sprintExhausted=false;
  matchEnded=false;
  playerReady=false;
  if (!basePlaced) {
    const angle=Math.random()*Math.PI*2;
    setStartPosition({x:Math.round(Math.cos(angle)*305),z:Math.round(Math.sin(angle)*305)});
  }
  uiMode='game';
  beginBasePlacement();
  activatePvE(true);
  controls.lock();
}

playBtn.addEventListener('click',beginSolo);
resumeBtn.addEventListener('click',() => {
  if(!gameStarted||matchEnded)return;
  uiMode='game';
  startEl.style.display='none';
  controls.lock();
});
enterMatchBtn.addEventListener('click',() => {
  if (multiplayer.socket?.readyState!==WebSocket.OPEN || !multiplayer.peers.size) {
    setOnlineStatus('The match is not connected. Choose Quick match or join a room again.');
    return;
  }
  uiMode='game';
  gameStarted=true;
  resumeBtn.hidden=false;
  playBtn.textContent='New sandbox';
  matchEnded=false;
  if (basePlaced && !playerReady) {
    playerReady=true;
    sendPeerAction({kind:'ready'});
  }
  enterMatchBtn.textContent='Resume match';
  setOnlineStatus(`In match · room ${multiplayer.roomCode}`);
  beginBasePlacement();
  controls.lock();
});
quickMatchBtn.addEventListener('click',() => beginMatch('quick'));
createRoomBtn.addEventListener('click',() => beginMatch('create'));
joinRoomBtn.addEventListener('click',() => beginMatch('join',roomCodeInput.value));

function signalingURL() {
  const override=localStorage.getItem('rts-signaling-url');
  if (override) return override;
  return `${location.protocol==='https:' ? 'wss:' : 'ws:'}//${location.host}/api/matchmaking`;
}

function beginMatch(mode,roomCode='') {
  if (!currentPlayerName()) return;
  ACTIVE_PRESET=PRESETS.BATTLE_ROYALE;
  balancePresetSelect.value='BATTLE_ROYALE';
  if (mode==='join' && !roomCode.trim()) {
    onlineStatus.textContent='Enter a room code first.';
    roomCodeInput.focus();
    return;
  }
  if (restartForNewGame(mode,roomCode)) return;
  closeMultiplayer();
  gameStarted=false;
  resumeBtn.hidden=true;
  playBtn.textContent='Sandbox';
  sandboxMode=false;
  zoneRing.visible=true;
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
    if (multiplayer.socket!==socket) return;
    let message;
    try { message=JSON.parse(event.data); } catch { return; }
    if (message.type==='waiting') {
      multiplayer.roomCode=message.roomCode;
      roomCodeInput.value=message.roomCode;
      setOnlineStatus(`Waiting for a player · room code ${message.roomCode}`);
    } else if (message.type==='matched') {
      multiplayer.roomCode=message.roomCode;
      multiplayer.playerId=message.playerId;
      multiplayer.isHost=message.isHost;
      multiplayer.hostId=message.players[0]?.id;
      const colors=[0x315b88,0x973d4d,0x54854a];
      const local=message.players.find(player => player.id===message.playerId);
      multiplayer.localSlot=local?.slot||0;
      multiplayer.sectorAngle=local?.sectorAngle;
      multiplayer.sectorCount=local?.sectorCount;
      if(!basePlaced && uiMode==='game')updateBasePrompt();
      sleeve.material.color.set(colors[local?.slot||0]);
      for (const peer of multiplayer.peers.values()) {peer.rtc?.close();if(peer.remote)clearRemotePlayer(peer);}
      multiplayer.peers=new Map(message.players.filter(player => player.id!==message.playerId).map(player => [player.id,{...player,ready:false,alive:true,remote:null}]));
      for(const peer of multiplayer.peers.values())setupPeerConnection(peer);
      playerHealth=100;
      playerStamina=100;
      sprintExhausted=false;
      matchEnded=false;
      playerReady=false;
      setStartPosition(message.spawn);
      if(multiplayer.isHost)activatePvE(true);
      roomCodeInput.value=message.roomCode;
      enterMatchBtn.hidden=false;
      enterMatchBtn.textContent='Enter match';
      setOnlineStatus(`Match ready · room ${message.roomCode} · click Enter match in this window`);
    } else if (message.type==='game') {
      if(message.packet?.to&&message.packet.to!==multiplayer.playerId)return;
      if(message.packet?.type==='rtc')handleRtcSignal(message.packet,message.from);
      else handleGamePacket(message.packet,message.from);
    } else if (message.type==='peer-left') {
      const peer=multiplayer.peers.get(message.playerId);
      if (peer) { peer.alive=false; peer.rtc?.close();clearRemotePlayer(peer); }
      if(message.playerId===multiplayer.hostId) {
        const next=[{id:multiplayer.playerId,slot:multiplayer.localSlot},...activePeers()].sort((a,b)=>a.slot-b.slot)[0];
        multiplayer.hostId=next?.id;multiplayer.isHost=next?.id===multiplayer.playerId;
      }
      if (playerReady && !matchEnded && !activePeers().length) finishMatch(true);
      if (!matchEnded) setOnlineStatus('A player disconnected.');
    } else if (message.type==='error') {
      setOnlineStatus(message.message || 'Matchmaking error.');
    }
  });
  socket.addEventListener('error',() => {
    if (multiplayer.socket===socket) setOnlineStatus('Matchmaking server unavailable. Start the server with npm start.');
  });
  socket.addEventListener('close',() => {
    if (multiplayer.socket!==socket) return;
    for (const peer of multiplayer.peers.values()) clearRemotePlayer(peer);
    multiplayer.peers.clear();
    multiplayer.roomCode='';
    enterMatchBtn.hidden=true;
    setOnlineStatus('Match connection closed. Choose Quick match or join a room again.');
  });
}

function handleGamePacket(packet,from) {
  if(packet?.type==='position')updateRemotePlayer(packet,from);
  else if(packet?.type==='units')updateRemoteUnits(packet.units,from);
  else if(packet?.type==='wildlife'&&from===multiplayer.hostId)updateRemoteWildlife(packet.deer);
  else if(packet?.type==='action')applyRemoteAction(packet.action,from);
}
function sendSignal(to,signal) {
  if(multiplayer.socket?.readyState===WebSocket.OPEN)multiplayer.socket.send(JSON.stringify({type:'game',packet:{type:'rtc',to,signal}}));
}
function wireChannel(peer,channel) {
  if(channel.label==='transient')peer.transient=channel;
  else if(channel.label==='reliable')peer.reliable=channel;
  channel.onmessage=event=>{try{handleGamePacket(JSON.parse(event.data),peer.id);}catch{ /* Ignore malformed peer packets. */ }};
}
async function setupPeerConnection(peer) {
  if(typeof RTCPeerConnection==='undefined')return;
  try {
    const rtc=new RTCPeerConnection();peer.rtc=rtc;
    rtc.onicecandidate=event=>{if(event.candidate)sendSignal(peer.id,{candidate:event.candidate});};
    rtc.ondatachannel=event=>wireChannel(peer,event.channel);
    if(multiplayer.playerId<peer.id) {
      wireChannel(peer,rtc.createDataChannel('transient',{ordered:false,maxRetransmits:0}));
      wireChannel(peer,rtc.createDataChannel('reliable'));
      const offer=await rtc.createOffer();await rtc.setLocalDescription(offer);sendSignal(peer.id,{description:rtc.localDescription});
    }
  } catch {peer.rtc?.close();peer.rtc=null;}
}
async function handleRtcSignal(packet,from) {
  const peer=multiplayer.peers.get(from),rtc=peer?.rtc,signal=packet.signal;
  if(!rtc||!signal)return;
  try {
    if(signal.description) {
      await rtc.setRemoteDescription(signal.description);
      if(signal.description.type==='offer') {const answer=await rtc.createAnswer();await rtc.setLocalDescription(answer);sendSignal(from,{description:rtc.localDescription});}
      for(const candidate of peer.pendingCandidates||[])await rtc.addIceCandidate(candidate);
      peer.pendingCandidates=[];
    } else if(signal.candidate) {
      if(rtc.remoteDescription)await rtc.addIceCandidate(signal.candidate);
      else (peer.pendingCandidates??=[]).push(signal.candidate);
    }
  } catch { /* WebSocket gameplay remains available if peer negotiation fails. */ }
}
function sendGamePacket(packet) {
  if(multiplayer.socket?.readyState!==WebSocket.OPEN)return;
  for(const peer of multiplayer.peers.values()) {
    if(!peer.alive)continue;
    const channel=['position','units','wildlife'].includes(packet.type) ? peer.transient : peer.reliable;
    if(channel?.readyState==='open')channel.send(JSON.stringify(packet));
    else multiplayer.socket.send(JSON.stringify({type:'game',packet:{...packet,to:peer.id}}));
  }
}

function makeRemoteAvatar(name,slot) {
  const avatar=new THREE.Group();
  const cloth=new THREE.MeshLambertMaterial({color:[0x315b88,0x973d4d,0x54854a][slot]||0x315b88});
  const capeMat=new THREE.MeshLambertMaterial({color:[0x183960,0x571c2b,0x294e29][slot]||0x183960,side:THREE.DoubleSide});
  const gold=new THREE.MeshLambertMaterial({color:0xe8b953,metalness:.25});
  const skin=new THREE.MeshLambertMaterial({color:0xc9966b});
  const steel=new THREE.MeshLambertMaterial({color:0xb4c1c4});
  const dark=new THREE.MeshLambertMaterial({color:0x382b27});
  const add=(geometry,material,x,y,z,parent=avatar) => {
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z);
    mesh.castShadow=true;
    parent.add(mesh);
    return mesh;
  };
  add(new THREE.CylinderGeometry(.25,.43,1.0,8),cloth,0,.75,0);
  add(new THREE.BoxGeometry(.65,.48,.36),steel,0,1.39,0);
  add(new THREE.BoxGeometry(.68,.1,.4),gold,0,1.13,0);
  add(new THREE.BoxGeometry(.16,.28,.04),gold,0,1.39,.205);
  add(new THREE.SphereGeometry(.24,10,8),skin,0,1.88,0);
  add(new THREE.ConeGeometry(.15,.24,7),dark,0,1.64,.16);
  add(new THREE.BoxGeometry(.12,.08,.1),skin,0,1.83,.245);
  for (const x of [-.1,.1]) {
    add(new THREE.SphereGeometry(.025,6,5),dark,x,1.91,.218);
  }
  add(new THREE.CylinderGeometry(.29,.29,.13,9),gold,0,2.14,0);
  for (let i=0;i<7;i++) {
    const angle=i*Math.PI*2/7;
    add(new THREE.ConeGeometry(.075,.22,5),gold,Math.sin(angle)*.23,2.3,Math.cos(angle)*.23);
  }
  const cape=add(new THREE.PlaneGeometry(.82,1.25),capeMat,0,.98,-.28);
  cape.rotation.x=-.16;
  const legs=[];
  for (const x of [-.18,.18]) {
    const leg=new THREE.Group();
    leg.position.set(x,.58,0);
    add(new THREE.BoxGeometry(.2,.6,.22),dark,0,-.3,0,leg);
    add(new THREE.BoxGeometry(.23,.13,.32),dark,0,-.58,.07,leg);
    avatar.add(leg);
    legs.push(leg);
  }
  const arms=[];
  for (const side of [-1,1]) {
    const arm=new THREE.Group();
    arm.position.set(side*.42,1.54,0);
    add(new THREE.BoxGeometry(.2,.55,.22),cloth,side*.04,-.27,0,arm);
    add(new THREE.SphereGeometry(.11,8,6),skin,side*.04,-.58,0,arm);
    avatar.add(arm);
    arms.push(arm);
  }
  add(new THREE.BoxGeometry(.06,.8,.09),steel,.52,.74,.21);
  add(new THREE.BoxGeometry(.3,.07,.11),gold,.52,.34,.21);
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
  label.position.y=3.12;
  avatar.add(label);
  const healthBar=new THREE.Group();
  healthBar.position.y=2.6;
  const back=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.17),new THREE.MeshBasicMaterial({color:0x241f1e,depthTest:false}));
  const fill=new THREE.Mesh(new THREE.PlaneGeometry(1.14,.11),new THREE.MeshBasicMaterial({color:0x65d873,depthTest:false}));
  fill.position.z=.005;
  healthBar.add(back,fill);
  avatar.add(healthBar);
  avatar.userData={name,legs,arms,walk:0,lastPosition:null,healthBar,healthFill:fill};
  scene.add(avatar);
  return avatar;
}

function updateRemotePlayer(state,from) {
  const peer=multiplayer.peers.get(from);
  if (!peer || !peer.alive) return;
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z) || !Number.isFinite(state.yaw)) return;
  const name=String(state.name || 'Player').slice(0,20);
  if (!peer.remote || peer.remote.userData.name!==name) {
    clearRemotePlayer(peer);
    peer.remote=makeRemoteAvatar(name,peer.slot);
  }
  const avatar=peer.remote;
  avatar.userData.peerId=from;
  const next=new THREE.Vector3(THREE.MathUtils.clamp(state.x,-WORLD_RADIUS,WORLD_RADIUS),0,THREE.MathUtils.clamp(state.z,-WORLD_RADIUS,WORLD_RADIUS));
  const step=avatar.userData.lastPosition ? avatar.userData.lastPosition.distanceTo(next) : 0;
  avatar.userData.walk+=Math.min(step,1)*7;
  avatar.userData.lastPosition=next.clone();
  avatar.position.copy(next);
  avatar.rotation.y=state.yaw;
  const swing=Math.min(1,step*3)*Math.sin(avatar.userData.walk);
  avatar.userData.legs[0].rotation.x=swing*.5;
  avatar.userData.legs[1].rotation.x=-swing*.5;
  avatar.userData.arms[0].rotation.x=-swing*.28;
  avatar.userData.arms[1].rotation.x=swing*.28;
  if (Number.isFinite(state.health)) {
    const fraction=THREE.MathUtils.clamp(state.health/100,0,1);
    avatar.userData.healthFill.scale.x=fraction;
    avatar.userData.healthFill.position.x=-(1-fraction)*.57;
  }
}

function updateRemoteUnits(units,from) {
  if (!Array.isArray(units)) return;
  for (const state of units.slice(0,100)) {
    const unit=npcs.find(n=>n.userData.id===state.id && (n.userData.ownerId===from || (from===multiplayer.hostId&&n.userData.ownerId==='pve')));
    if (!unit || !Number.isFinite(state.x) || !Number.isFinite(state.z) || !Number.isFinite(state.yaw)) continue;
    unit.position.set(THREE.MathUtils.clamp(state.x,-WORLD_RADIUS,WORLD_RADIUS),0,THREE.MathUtils.clamp(state.z,-WORLD_RADIUS,WORLD_RADIUS));
    unit.rotation.y=state.yaw;
    unit.userData.state=state.state || 'Following orders';
    unit.userData.attacking=!!state.attacking;
    if(unit.userData.kind==='lumberjack')unit.userData.target=trees.find(tree=>tree.userData.id===state.targetId)||null;
    if(unit.userData.kind==='hunter')unit.userData.target=deer.find(animal=>animal.userData.id===state.targetId)||null;
  }
}

function clearRemotePlayer(peer) {
  if (peer.remote) {
    scene.remove(peer.remote);
    peer.remote.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
  }
  peer.remote=null;
}

function closeMultiplayer() {
  for (const peer of multiplayer.peers.values()) {peer.rtc?.close();clearRemotePlayer(peer);}
  multiplayer.socket?.close();
  multiplayer.socket=null;
  multiplayer.peers.clear(); multiplayer.roomCode='';
  multiplayer.playerId='';
  multiplayer.sectorAngle=null;
  multiplayer.sectorCount=null;
  playerReady=false;
  multiplayer.status='Offline';
  enterMatchBtn.hidden=true;
}

function sendPeerAction(action) {
  sendGamePacket({type:'action',action});
}

function finishMatch(won,place=won ? 1 : activePeers().length+1) {
  if (matchEnded) return;
  matchEnded=true;
  playerReady=false;
  fallbackLook=false;
  controls.unlock();
  uiMode='result';
  startEl.style.display='none';
  outcomeTitle.textContent=won ? 'Victory Royale' : 'Defeat';
  outcomePlace.textContent=`${place}${place===1?'st':place===2?'nd':'rd'} place`;
  outcomeEl.hidden=false;
  playSound(won ? 'victory' : 'death',.26);
}

function damagePlayer(amount) {
  if (matchEnded || !playerReady || !basePlaced) return;
  playerHealth=Math.max(0,playerHealth-Math.min(30,Math.max(0,Number(amount)||0)));
  playSound('hit',.2);
  if (playerHealth===0) {
    sendPeerAction({kind:'defeat'});
    finishMatch(false,activePeers().length+1);
  }
}

function damageUnit(id,amount) {
  const unit=npcs.find(n=>n.userData.id===id);
  if (!unit || !unit.userData.alive) return;
  unit.userData.hp=Math.max(0,unit.userData.hp-Math.min(30,Math.max(0,Number(amount)||0)));
  playSound('hit',.08);
  if (unit.userData.hp===0) { playSound('death',.09); killNPC(unit); }
}
function damageBuilding(x,z,amount) {
  const building=buildings.find(b=>Math.abs(b.position.x-x)<.1&&Math.abs(b.position.z-z)<.1);
  if(!building)return;
  building.userData.hp=Math.max(0,(building.userData.hp||180)-Math.min(30,Math.max(0,amount)));
  if(building.userData.hp===0)demolishSelectedBuilding(building,false,true);
}
function resolveHit(target,amount,weapon,attackerId=null) {
  const isKing=target===camera||!!target.userData.peerId;
  const targetId=isKing ? (target===camera?localOwner():target.userData.peerId) : target.userData.id;
  if(multiplayer.peers.size&&!multiplayer.isHost) {
    sendPeerAction({kind:'damage-request',targetType:isKing?'king':'unit',targetId,attackerId,weapon});
    return;
  }
  if(isKing) {
    if(target===camera)damagePlayer(amount);
    else sendPeerAction({kind:'player-hit',targetId,amount,weapon});
  } else {
    damageUnit(targetId,amount);
    sendPeerAction({kind:'unit-hit',unitId:targetId,amount,weapon});
  }
}
function resolveBuildingHit(target,amount,attackerId) {
  if(multiplayer.peers.size&&!multiplayer.isHost){sendPeerAction({kind:'damage-request',targetType:'building',x:target.position.x,z:target.position.z,attackerId});return;}
  damageBuilding(target.position.x,target.position.z,amount);
  sendPeerAction({kind:'building-hit',x:target.position.x,z:target.position.z,amount});
}
function resolveRemoteDamageRequest(action,from) {
  if(!multiplayer.isHost)return;
  const attacker=action.attackerId ? npcs.find(n=>n.userData.id===action.attackerId&&n.userData.ownerId===from) : multiplayer.peers.get(from)?.remote;
  if(!attacker)return;
  const target=action.targetType==='king' ? action.targetId===localOwner()?camera:multiplayer.peers.get(action.targetId)?.remote : action.targetType==='building' ? buildings.find(b=>Math.abs(b.position.x-action.x)<.1&&Math.abs(b.position.z-action.z)<.1) : npcs.find(n=>n.userData.id===action.targetId);
  if(!target||target.userData?.alive===false)return;
  const stats=attacker.userData?.kind ? UNITS[attacker.userData.kind] : null;
  if((action.attackerId&&!stats)||action.targetId===from||target.userData?.ownerId===from)return;
  const reach=stats?.range||3.7;
  if(dist2D(attacker.position,target.position)>reach+5)return;
  const armour=action.targetType==='unit'?UNITS[target.userData.kind]?.armour||0:0;
  const meleePenalty=stats?.range>3&&dist2D(attacker.position,target.position)<2 ? .5 : 1;
  const amount=Math.max(1,Math.round((stats?.damage||20)*meleePenalty)-Math.max(0,armour-(stats?.penetration||0)));
  if(action.targetType==='building')resolveBuildingHit(target,amount,action.attackerId);
  else resolveHit(target,amount,stats?.range>3?'bow':'sword',attacker.userData?.id||null);
}

function findBuildingAt(type,x,z) {
  return buildings.find(building => building.userData.type===type && Math.abs(building.position.x-x)<.1 && Math.abs(building.position.z-z)<.1);
}

function applyRemoteAction(action,from) {
  if (!action || typeof action.kind!=='string') return;
  if (action.kind==='ready') {
    const peer=multiplayer.peers.get(from);
    if (peer) peer.ready=true;
  } else if (action.kind==='player-hit') {
    if(multiplayer.peers.size&&from!==multiplayer.hostId)return;
    if (action.targetId!==multiplayer.playerId) return;
    if (action.weapon==='archer') playSound('bow',.11);
    else if (action.weapon==='swordsman') playSound('sword',.13);
    damagePlayer(action.amount);
  } else if(action.kind==='zone-hit'&&action.targetId===multiplayer.playerId) {
    damagePlayer(action.amount);
  } else if (action.kind==='unit-hit' && typeof action.unitId==='string') {
    if(multiplayer.peers.size&&from!==multiplayer.hostId)return;
    if (action.weapon==='archer') playSound('bow',.08);
    else if (action.weapon==='swordsman') playSound('sword',.08);
    damageUnit(action.unitId,action.amount);
  } else if(action.kind==='damage-request') {
    resolveRemoteDamageRequest(action,from);
  } else if(action.kind==='building-hit' && Number.isFinite(action.x)&&Number.isFinite(action.z)) {
    if(multiplayer.peers.size&&from!==multiplayer.hostId)return;
    damageBuilding(action.x,action.z,action.amount);
  } else if (action.kind==='defeat') {
    const peer=multiplayer.peers.get(from);
    if (peer) { peer.alive=false; clearRemotePlayer(peer); }
    if (!activePeers().length && playerReady) finishMatch(true);
  } else if (action.kind==='base' && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    placeStarterBase(action.x,action.z,from,false,action.storage);
  } else if (action.kind==='zone' && multiplayer.peers.size && !multiplayer.isHost) {
    applyZoneState(action);
  } else if(action.kind==='pve-camp' && from===multiplayer.hostId && Number.isFinite(action.x)&&Number.isFinite(action.z)&&Number.isInteger(action.index)) {
    createPvECamp(action.x,action.z,action.index,false);
  } else if(action.kind==='deer-spawn'&&from===multiplayer.hostId&&Array.isArray(action.members)) {
    const herd={members:[],heading:0,turnIn:4};
    for(const state of action.members.slice(0,8))if(Number.isFinite(state.x)&&Number.isFinite(state.z)&&!deer.some(animal=>animal.userData.id===state.id)) {
      const animal=makeDeer(new THREE.Vector3(state.x,0,state.z),herd);animal.userData.id=state.id;herd.members.push(animal);
    }
    if(herd.members.length)herds.push(herd);
  } else if(action.kind==='deer-kill'&&typeof action.id==='string') {
    const animal=deer.find(item=>item.userData.id===action.id);
    if(animal){animal.userData.alive=false;scene.remove(animal);deer.splice(deer.indexOf(animal),1);}
  } else if(action.kind==='stock'&&typeof action.resource==='string'&&Number.isFinite(action.amount)) {
    const store=buildings.find(b=>b.userData.ownerId===from&&Math.abs(b.position.x-action.x)<.1&&Math.abs(b.position.z-action.z)<.1);
    if(store?.userData.stock&&action.resource in store.userData.stock)store.userData.stock[action.resource]=Math.max(0,action.amount);
  } else if(action.kind==='settlement-state'&&action.state&&multiplayer.peers.has(from)) {
    multiplayer.peers.get(from).settlement=action.state;
  } else if(action.kind==='pve-reward'&&action.targetId===localOwner()) {
    settlement.gold+=75;addResource('meat',10);const stored=addResource('spear',2);if(stored<2)dropPackage({x:action.x,z:action.z},'spear',2-stored);syncResources();toast('Bandit camp cleared: gold and supplies');
  } else if(action.kind==='civilian-left'&&typeof action.unitId==='string') {
    const civilian=npcs.find(n=>n.userData.id===action.unitId&&n.userData.ownerId===from);if(civilian)killNPC(civilian,true);
  } else if(action.kind==='peasant-arrived' && Number.isFinite(action.x)&&Number.isFinite(action.z)) {
    const house=findBuildingAt('house',action.buildingX,action.buildingZ);
    if(house&&house.userData.ownerId===from) {const peasant=makeNPC('peasant',new THREE.Vector3(action.x,0,action.z));peasant.userData.id=action.unitId;peasant.userData.ownerId=from;peasant.userData.home=house;house.userData.units.push(peasant);}
  } else if(action.kind==='worker-assigned' && Number.isFinite(action.x)&&Number.isFinite(action.z)) {
    const building=buildings.find(b=>b.userData.ownerId===from&&Math.abs(b.position.x-action.buildingX)<.1&&Math.abs(b.position.z-action.buildingZ)<.1);
    if(building) {
      const idle=npcs.find(n=>n.userData.kind==='peasant'&&n.userData.ownerId===from);
      if(idle){idle.userData.home?.userData.units.splice(idle.userData.home.userData.units.indexOf(idle),1);scene.remove(idle);npcs.splice(npcs.indexOf(idle),1);}
      const worker=makeNPC(action.workerKind,new THREE.Vector3(action.x,0,action.z));worker.userData.id=action.unitId;worker.userData.ownerId=from;worker.userData.job=action.job;worker.userData.home=building;building.userData.units.push(worker);
      if(action.workerKind==='muleHandler')building.userData.handler=worker;
    }
  } else if(action.kind==='ox-spawn' && Number.isFinite(action.x)&&Number.isFinite(action.z)) {
    const tether=buildings.find(b=>b.userData.type==='oxTether'&&b.userData.ownerId===from&&Math.abs(b.position.x-action.buildingX)<.1&&Math.abs(b.position.z-action.buildingZ)<.1);
    if(tether){const ox=makeNPC('mule',new THREE.Vector3(action.x,0,action.z));ox.userData.id=action.unitId;ox.userData.ownerId=from;ox.userData.home=tether;tether.userData.mule=ox;tether.userData.units.push(ox);}
  } else if(action.kind==='recipe' && Number.isFinite(action.x)&&Number.isFinite(action.z)) {
    const building=buildings.find(b=>b.userData.ownerId===from&&Math.abs(b.position.x-action.x)<.1&&Math.abs(b.position.z-action.z)<.1);
    if(building&&RECIPE_OPTIONS[building.userData.type]?.[action.index])building.userData.recipe={...RECIPES[building.userData.type],...RECIPE_OPTIONS[building.userData.type][action.index]};
  } else if (action.kind==='build' && BUILDINGS[action.buildingType] && action.buildingType!=='house' && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    if (buildings.some(building => Math.hypot(building.position.x-action.x,building.position.z-action.z)<.5)) return;
    createBuilding(action.buildingType,action.x,action.z,from);
  } else if (action.kind==='recruit' && UNITS[action.unit] && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    const barracks=findBuildingAt(action.buildingType||'barracks',action.x,action.z);
    if (barracks) {
      const npc=makeNPC(action.unit,spawnPosition(barracks));
      npc.userData.home=barracks;
      npc.userData.id=action.unitId;
      npc.userData.ownerId=from;
      barracks.userData.units.push(npc);
      playNearby('train',barracks.position,.13);
    }
  } else if (action.kind==='rally' && Number.isFinite(action.x) && Number.isFinite(action.z) && Number.isFinite(action.rallyX) && Number.isFinite(action.rallyZ)) {
    const barracks=findBuildingAt('barracks',action.x,action.z)||findBuildingAt('mercenaryPost',action.x,action.z);
    if (barracks) setRallyPoint(barracks,new THREE.Vector3(action.rallyX,0,action.rallyZ),false,!!action.attackPlayer);
  } else if(action.kind==='order'&&typeof action.command==='string') {
    const building=buildings.find(b=>b.userData.ownerId===from&&Math.abs(b.position.x-action.x)<.1&&Math.abs(b.position.z-action.z)<.1);
    if(building){building.userData.order=action.command;for(const unit of building.userData.units)if(isMilitary(unit.userData.kind))unit.userData.order=action.command;}
  } else if (action.kind==='demolish' && Number.isFinite(action.x) && Number.isFinite(action.z)) {
    const building=buildings.find(item => item.userData.type!=='house' && Math.abs(item.position.x-action.x)<.1 && Math.abs(item.position.z-action.z)<.1);
    if (building&&building.userData.ownerId===from) demolishSelectedBuilding(building,false,true);
  }
}
controls.addEventListener('lock', () => { fallbackLook=false; startEl.style.display = 'none'; });
controls.addEventListener('unlock', () => {
  if (uiMode === 'game') uiMode = 'main';
  resumeBtn.hidden=!gameStarted||matchEnded;
  startEl.style.display = uiMode === 'main' ? 'flex' : 'none';
});
document.addEventListener('pointerlockerror',() => {
  if (uiMode!=='game') return;
  fallbackLook=true;
  startEl.style.display='none';
  toast('Mouse look fallback active · move mouse to turn · Esc for menu');
});
document.addEventListener('mousemove',event => {
  if (!fallbackLook || uiMode!=='game') return;
  camera.rotation.order='YXZ';
  camera.rotation.y-=event.movementX*.002;
  camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-event.movementY*.002,-Math.PI/2+.02,Math.PI/2-.02);
});

const hemi = new THREE.HemisphereLight(0xddeeff, 0x56603a, 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const GRID = TILE_SIZE * 2;
const logicalGrid = new LogicalGrid();
const PLAYER_RADIUS = 0.55;
const BUILDING_HALF_SIZE = 1.6;
const WORK_RANGE = { quarry:35 };
const STOCKPILE_CAPACITY = Object.fromEntries(RESOURCES.map(kind=>[kind,STOCKPILE_ITEMS.includes(kind) ? STORAGE_CAPACITY.stockpile : 0]));
const GRANARY_CAPACITY = Object.fromEntries(RESOURCES.map(kind=>[kind,FOOD.includes(kind) ? STORAGE_CAPACITY.granary : 0]));
const ARMOURY_CAPACITY = Object.fromEntries(RESOURCES.map(kind=>[kind,ARMOURY_ITEMS.includes(kind) ? STORAGE_CAPACITY.armoury : 0]));
const RESOURCE_KINDS = [...RESOURCES,'food'];
const TREE_LOGS = WORKER_CYCLES.treeLogs;
const WOOD_PER_BATCH = WORKER_CYCLES.woodCarry;
const MEAT_PER_DEER = WORKER_CYCLES.meatPerDeer;
const MULE_LOAD = WORKER_CYCLES.oxCapacity;
const QUARRY_MINING_TIME = WORKER_CYCLES.quarryWork;
const HUNTER_CARRY_SPEED = 1.25;
const EYE_HEIGHT = 2;
const WALK_SPEED = 3.75;
const SPRINT_MULTIPLIER = 2;
const JUMP_SPEED = 8;
const GRAVITY = 20;
const keys = {};
let jumpRequested = false;
let verticalVelocity = 0;
let grounded = true;
let footstepDistance = 0;
let lastPlayerFootstepAt = 0;
const clock = new THREE.Clock();
let selectedBuild = null;
let buildGhost = null;
let lastToastTimer = null;

const resources = Object.fromEntries(RESOURCE_KINDS.map(kind=>[kind,0]));
const costs = Object.fromEntries(Object.entries(BUILDINGS).map(([kind,config])=>[kind,config.cost]));
const buildingCost=type=>type==='stockpile'&&buildings.some(b=>b.userData.type==='stockpile'&&b.userData.ownerId===localOwner()) ? BUILDINGS.stockpile.expansionCost : costs[type];
const settlement = {population:0,idlePeasants:0,housingCapacity:POPULARITY.initialHousing,popularity:50,gold:100,ration:2,tax:0,foodEnabled:Object.fromEntries(FOOD.map(kind=>[kind,true])),immigrationTimer:0,foodDebt:0,monthTimer:0,lowPopularityTime:0};
const isMilitary = kind=>!!UNITS[kind];
const localOwner=()=>multiplayer.playerId||'sandbox';

const buildings = [];
const trees = [];
const treeHash=new SpatialHash(16);
const rocks = [];
const stoneDeposits = [];
const ironDeposits = [];
const oases=[];
const deer = [];
let deerIdCounter=0;
const npcs = [];
const herds = [];
const pveCamps=[];
const droppedPackages=[];
function dropPackage(position,kind,amount) {
  if(!amount||!Number.isFinite(position.x)||!Number.isFinite(position.z))return;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.55,.38,.55),new THREE.MeshLambertMaterial({color:kind==='wood'?0x79502d:kind==='stone'?0x979d9f:kind==='spear'?0xc3c8c8:0xc08d59}));
  mesh.position.set(position.x,.2,position.z);scene.add(mesh);droppedPackages.push({mesh,kind,amount});
}
let deerSpawnTimer = 0;

const statsEl = document.querySelector('#stats');
const toastEl = document.querySelector('#toast');

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => toastEl.style.opacity = '0', 1200);
}
function playNearby(kind,pos,volume=.16) {
  const distance=dist2D(pos,camera.position);
  if (distance<28) playSound(kind,volume*(1-distance/30));
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
const terrainPatchMeshes=[0x769f58,0x66894d].map(color=>{
  const mesh=new THREE.InstancedMesh(new THREE.CircleGeometry(1,12),new THREE.MeshLambertMaterial({color}),130);
  mesh.count=0;
  scene.add(mesh);
  return mesh;
});
const terrainTransform=new THREE.Object3D();
for (let i=0; i<130; i++) {
  const p = randomPointInCircle(0, WORLD_RADIUS-2);
  const radius=rand(1.4,4.5),patch=terrainPatchMeshes[Math.random()<.5?0:1];
  terrainTransform.position.set(p.x,.012,p.z);
  terrainTransform.rotation.x=-Math.PI/2;
  terrainTransform.scale.setScalar(radius);
  terrainTransform.updateMatrix();
  patch.setMatrixAt(patch.count++,terrainTransform.matrix);
  patch.instanceMatrix.needsUpdate=true;
}

// The logical map boundary is collision-only; the battle royale ring is shown separately.

const treeCapacity=780+3*65;
const treeTrunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.32,2.1,6),new THREE.MeshLambertMaterial({color:0x704526}),treeCapacity);
const treeCrowns=new THREE.InstancedMesh(new THREE.ConeGeometry(1.05,2.6,7),new THREE.MeshLambertMaterial({color:0x2f6e32}),treeCapacity);
treeTrunks.castShadow=treeCrowns.castShadow=true;
treeTrunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
treeCrowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(treeTrunks,treeCrowns);
const treeTransform=new THREE.Object3D();
const hiddenTreeMatrix=new THREE.Matrix4().makeScale(0,0,0);
function setTreeCrownScale(tree,scale) {
  treeTransform.position.set(tree.position.x,3,tree.position.z);
  treeTransform.scale.setScalar(scale);
  treeTransform.updateMatrix();
  treeCrowns.setMatrixAt(tree.userData.instanceIndex,treeTransform.matrix);
  treeCrowns.instanceMatrix.needsUpdate=true;
}
function hideTree(tree) {
  tree.userData.alive=false;
  treeTrunks.setMatrixAt(tree.userData.instanceIndex,hiddenTreeMatrix);
  treeCrowns.setMatrixAt(tree.userData.instanceIndex,hiddenTreeMatrix);
  treeTrunks.instanceMatrix.needsUpdate=true;
  treeCrowns.instanceMatrix.needsUpdate=true;
}
function makeTree(pos) {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.userData.alive = true;
  group.userData.id = `tree-${trees.length}`;
  group.userData.instanceIndex=trees.length;
  group.userData.logsRemaining = TREE_LOGS;
  treeTransform.position.set(pos.x,1.05,pos.z);
  treeTransform.scale.setScalar(1);
  treeTransform.updateMatrix();
  treeTrunks.setMatrixAt(group.userData.instanceIndex,treeTransform.matrix);
  setTreeCrownScale(group,1);
  treeTrunks.instanceMatrix.needsUpdate=true;
  trees.push(group);
  treeHash.insert(group);
}
for (let i=0; i<780; i++) makeTree(randomPointInCircle(15, WORLD_RADIUS-5));
for (let a=0;a<3;a++) {
  const angle=a*Math.PI*2/3,center=new THREE.Vector3(Math.cos(angle)*305,0,Math.sin(angle)*305);
  for(let i=0;i<65;i++) makeTree(center.clone().add(new THREE.Vector3(rand(-55,55),0,rand(-55,55))));
}

const rockInstances=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.75,0),new THREE.MeshLambertMaterial({color:0x858b84}),25*7*3);
rockInstances.count=0;
rockInstances.castShadow=true;
rockInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(rockInstances);
const rockTransform=new THREE.Object3D();
function setRockScale(rock,scale) {
  for(let i=0;i<3;i++) {
    rockTransform.position.set(rock.position.x+(i-1)*.55*scale,.5*scale,rock.position.z+.2*(i%2)*scale);
    rockTransform.rotation.y=i*.7;
    rockTransform.scale.setScalar(scale*(.75-i*.13)/.75);
    rockTransform.updateMatrix();
    rockInstances.setMatrixAt(rock.userData.instanceStart+i,rockTransform.matrix);
  }
  rockInstances.instanceMatrix.needsUpdate=true;
}
function hideRock(rock) {
  rock.userData.alive=false;
  for(let i=0;i<3;i++)rockInstances.setMatrixAt(rock.userData.instanceStart+i,hiddenTreeMatrix);
  rockInstances.instanceMatrix.needsUpdate=true;
}
function makeRock(pos) {
  const group=new THREE.Group();
  group.position.copy(pos);
  group.userData={alive:true,stoneRemaining:40,instanceStart:rocks.length*3};
  setRockScale(group,1);
  rockInstances.count+=3;
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
      hideTree(tree);
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
for (let i=0, attempts=0;i<25 && attempts<700;attempts++) {
  const point=randomPointInCircle(85,260);
  const pos=new THREE.Vector3(Math.round(point.x/GRID)*GRID,0,Math.round(point.z/GRID)*GRID);
  if (stoneDeposits.some(deposit => dist2D(deposit.position,pos)<16)) continue;
  makeStoneDeposit(pos);
  i++;
}
function makeIronDeposit(pos) {
  for(const tree of trees)if(tree.userData.alive&&dist2D(tree.position,pos)<5)hideTree(tree);
  const mesh=new THREE.Mesh(new THREE.DodecahedronGeometry(3.2,1),new THREE.MeshLambertMaterial({color:0x4d5663}));
  mesh.position.set(pos.x,1.7,pos.z);mesh.scale.y=.53;scene.add(mesh);
  ironDeposits.push({position:pos,mine:null,remaining:320,mesh});
}
for(let i=0,attempts=0;i<16&&attempts<500;attempts++) {
  const p=i<4 ? randomPointInCircle(20,80) : randomPointInCircle(140,215),pos=new THREE.Vector3(Math.round(p.x/GRID)*GRID,0,Math.round(p.z/GRID)*GRID);
  if(ironDeposits.some(d=>dist2D(d.position,pos)<26)||stoneDeposits.some(d=>dist2D(d.position,pos)<16))continue;
  makeIronDeposit(pos);i++;
}
for(let i=0;i<16;i++) {
  const p=randomPointInCircle(70,340),r=rand(13,26);oases.push({position:p,radius:r});logicalGrid.setFertileCircle(p.x,p.z,r);
  const patch=new THREE.Mesh(new THREE.CircleGeometry(r,32),new THREE.MeshLambertMaterial({color:0x6eaa62,transparent:true,opacity:.58}));
  patch.rotation.x=-Math.PI/2;patch.position.set(p.x,.022,p.z);scene.add(patch);
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
  g.userData = { id:`deer-${deerIdCounter++}`,alive:true, hp:18, herd, legs, pupils, crosses, gait:rand(0,6), offset:new THREE.Vector3() };
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
  if(multiplayer.peers.size&&multiplayer.isHost)sendPeerAction({kind:'deer-spawn',members:herd.members.map(animal=>({id:animal.userData.id,x:animal.position.x,z:animal.position.z}))});
}
for (let i=0;i<4;i++) spawnHerd();

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
    const fire=new THREE.Mesh(new THREE.ConeGeometry(.34,.85,6),new THREE.MeshBasicMaterial({color:0xffab3b,transparent:ghost,opacity:ghost?.45:1}));
    fire.position.set(2.6,.52,-2.3);g.add(fire);g.userData.fire=fire;
    for(let i=0;i<6;i++){const angle=i*Math.PI/3,stone=new THREE.Mesh(new THREE.DodecahedronGeometry(.19,0),new THREE.MeshLambertMaterial({color:0x72706a}));stone.position.set(2.6+Math.cos(angle)*.55,.16,-2.3+Math.sin(angle)*.55);g.add(stone);}
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
  if(['wheatFarm','hops','orchard','dairy'].includes(type)) {
    const cropColor={wheatFarm:0xc5aa56,hops:0x498047,orchard:0x5d8e3e,dairy:0xb9a582}[type];
    const cropMat=new THREE.MeshLambertMaterial({color:cropColor,transparent:ghost,opacity:ghost?.45:1});
    const crops=[];
    for(let i=0;i<15;i++) {
      const crop=new THREE.Mesh(type==='orchard' ? new THREE.ConeGeometry(.42,1.1,6) : new THREE.CylinderGeometry(.04,.07,1.1,5),cropMat);
      crop.position.set(-3.5+(i%5)*1.7,.55,-3.4+Math.floor(i/5)*2.2);crop.scale.y=(type==='wheatFarm'&&!ghost) ? .15 : 1;
      g.add(crop);crops.push(crop);
    }
    g.userData.crops=crops;
  }
  if(type==='mill') {
    const sails=new THREE.Group();sails.position.set(0,3.2,1.75);
    const sailMat=new THREE.MeshLambertMaterial({color:0xe5dbc1,transparent:ghost,opacity:ghost?.45:1});
    for(let i=0;i<4;i++) {const sail=new THREE.Mesh(new THREE.BoxGeometry(.42,2.0,.08),sailMat);sail.position.y=1.05;sail.rotation.z=i*Math.PI/2;sails.add(sail);}
    g.add(sails);g.userData.sails=sails;
  }
  if(type==='bakery'||type==='blacksmith'||type==='armourer') {
    const chimney=new THREE.Mesh(new THREE.BoxGeometry(.6,1.6,.6),new THREE.MeshLambertMaterial({color:type==='bakery'?0xbd7950:0x514c48,transparent:ghost,opacity:ghost?.45:1}));
    chimney.position.set(1.1,3.6,-.7);g.add(chimney);
  }
  if(type==='armoury'||type==='fletcher'||type==='poleturner') {
    const rack=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.3,.18),new THREE.MeshLambertMaterial({color:0x6d472b,transparent:ghost,opacity:ghost?.45:1}));
    rack.position.set(0,.85,1.9);g.add(rack);
    if(type==='armoury') {
      const weapons=[];
      for(let i=0;i<6;i++){const weapon=new THREE.Mesh(new THREE.BoxGeometry(.1,1.1,.08),new THREE.MeshLambertMaterial({color:0xc1c7c7,transparent:ghost,opacity:ghost?.45:1}));weapon.position.set(-.9+i*.36,.85,2.03);weapon.visible=ghost;g.add(weapon);weapons.push(weapon);}
      g.userData.armouryVisuals=weapons;
    }
  }
  if(type==='market') {
    const awning=new THREE.Mesh(new THREE.ConeGeometry(2.5,.7,4),new THREE.MeshLambertMaterial({color:0xb75a39,transparent:ghost,opacity:ghost?.45:1}));
    awning.position.set(0,3.7,0);awning.rotation.y=Math.PI/4;g.add(awning);
  }
  if(type==='oxTether') {
    const railMat=new THREE.MeshLambertMaterial({color:0x734b2b,transparent:ghost,opacity:ghost?.45:1});
    for(const x of [-2,2]) {const rail=new THREE.Mesh(new THREE.BoxGeometry(.18,1.3,4),railMat);rail.position.set(x,.7,0);g.add(rail);}
  }
  if(type==='ironMine') {
    const ore=new THREE.Mesh(new THREE.DodecahedronGeometry(.65,0),new THREE.MeshLambertMaterial({color:0x454e61,transparent:ghost,opacity:ghost?.45:1}));ore.position.set(1.6,.5,1.5);g.add(ore);
  }
  if(type==='dairy') {
    const cow=new THREE.Group(),hide=new THREE.MeshLambertMaterial({color:0xeee4c8,transparent:ghost,opacity:ghost?.45:1});
    const torso=new THREE.Mesh(new THREE.BoxGeometry(1.2,.7,1.8),hide);torso.position.y=.75;cow.add(torso);
    const head=new THREE.Mesh(new THREE.BoxGeometry(.55,.6,.55),hide);head.position.set(0,1.03,1.05);cow.add(head);
    for(const x of [-.4,.4])for(const z of [-.55,.55]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.18,.6,.18),hide);leg.position.set(x,.3,z);cow.add(leg);}
    cow.position.set(3,0,1);cow.visible=ghost;g.add(cow);g.userData.cow=cow;
  }
  g.userData.type = type;
  if (!ghost) addSelectionArrow(g, type === 'stockpile' ? 2.15 : 4.45);
  return g;
}

function quarryDepositAt(x,z) {
  return stoneDeposits.find(deposit => Math.hypot(deposit.position.x-x,deposit.position.z-z)<2 && !deposit.quarry && deposit.rocks.some(rock => rock.userData.alive));
}
function ironDepositAt(x,z) { return ironDeposits.find(deposit=>dist2D(deposit.position,{x,z})<2 && !deposit.mine && deposit.remaining>0); }
function isBuildingSpotFree(x,z,type) {
  if (Math.hypot(x,z) > WORLD_RADIUS-4) return false;
  if (!basePlaced && !sandboxMode && multiplayer.sectorCount>=2 && ['house','stockpile','granary'].includes(type) &&
    !footprintInSector(x,z,...BUILDINGS[type].footprint,multiplayer.sectorAngle,multiplayer.sectorCount)) return false;
  if (type === 'quarry' && !quarryDepositAt(x,z)) return false;
  if (type === 'ironMine' && !ironDepositAt(x,z)) return false;
  if (BUILDINGS[type]?.fertile && !logicalGrid.isFertile(x,z)) return false;
  if (type !== 'quarry' && stoneDeposits.some(deposit => Math.hypot(deposit.position.x-x,deposit.position.z-z)<3.8)) return false;
  if (type !== 'ironMine' && ironDeposits.some(deposit => Math.hypot(deposit.position.x-x,deposit.position.z-z)<3.8)) return false;
  const [width,height]=BUILDINGS[type]?.footprint||[2,2];
  if(!logicalGrid.free(logicalGrid.footprint(x,z,width,height,0,BUILDINGS[type]?.mask))) return false;
  for (const b of buildings) if (Math.abs(b.position.x-x)<3.8 && Math.abs(b.position.z-z)<3.8) return false;
  const halfX=width*TILE_SIZE/2,halfZ=height*TILE_SIZE/2;
  for (const t of treeHash.nearby({x,z},Math.max(halfX,halfZ)+.7)) if (t.userData.alive && Math.abs(t.position.x-x)<halfX+.7 && Math.abs(t.position.z-z)<halfZ+.7) return false;
  for (const rock of rocks) if (rock.userData.alive && Math.abs(rock.position.x-x)<halfX+.8 && Math.abs(rock.position.z-z)<halfZ+.8) return false;
  for (const d of deer) if (d.userData.alive && Math.abs(d.position.x-x)<halfX+.5 && Math.abs(d.position.z-z)<halfZ+.5) return false;
  for (const n of npcs) if (Math.abs(n.position.x-x)<halfX+.4&&Math.abs(n.position.z-z)<halfZ+.4) return false;
  if (Math.abs(camera.position.x-x)<halfX+.5&&Math.abs(camera.position.z-z)<halfZ+.5) return false;
  return true;
}

function storageCapacity() {
  const result={};
  for(const kind of RESOURCE_KINDS) result[kind]=buildings.reduce((sum,b)=>sum+buildingStorageCapacity(b,kind),0);
  return result;
}

function buildingStorageCapacity(building, kind) {
  if(!building?.userData.stock) return 0;
  const type=building.userData.type;
  if(kind==='food') return type==='granary' ? STORAGE_CAPACITY.granary : 0;
  return (type==='granary' ? GRANARY_CAPACITY : type==='armoury' ? ARMOURY_CAPACITY : STOCKPILE_CAPACITY)[kind]||0;
}

function syncResources() {
  for (const kind of RESOURCES) {
    resources[kind] = buildings.reduce((total, building) => total + (building.userData.ownerId===localOwner() ? building.userData.stock?.[kind] || 0 : 0), 0);
  }
  resources.food=FOOD.reduce((sum,kind)=>sum+resources[kind],0);
  resources.gold=settlement.gold;
}
function sendSettlementState() {sendPeerAction({kind:'settlement-state',state:{population:settlement.population,idlePeasants:settlement.idlePeasants,housingCapacity:settlement.housingCapacity,popularity:settlement.popularity,gold:settlement.gold,ration:settlement.ration,tax:settlement.tax}});}

function addResource(kind, amount, preferred = null) {
  if(kind==='food') kind='meat';
  if(kind==='gold') {settlement.gold+=amount;syncResources();return amount;}
  const depots = buildings.filter(building => building.userData.ownerId===localOwner() && buildingStorageCapacity(building,kind)>0).sort((a,b)=>preferred ? dist2D(a.position,preferred.position)-dist2D(b.position,preferred.position) : 0);
  if (preferred && depots.includes(preferred)) {
    depots.splice(depots.indexOf(preferred), 1);
    depots.unshift(preferred);
  }
  let remaining = amount;
  for (const building of depots) {
    const compatible=building.userData.type==='granary' ? FOOD : building.userData.type==='armoury' ? ARMOURY_ITEMS : STOCKPILE_ITEMS;
    const occupied=compatible.reduce((sum,item)=>sum+(building.userData.stock[item]||0),0);
    const room = buildingStorageCapacity(building, kind) - occupied;
    const stored = Math.min(remaining, Math.max(0, room));
    building.userData.stock[kind] += stored;
    if(stored>0)sendPeerAction({kind:'stock',x:building.position.x,z:building.position.z,resource:kind,amount:building.userData.stock[kind]});
    remaining -= stored;
    if (!remaining) break;
  }
  syncResources();
  if (amount>remaining && preferred) playNearby('gather',preferred.position,.09);
  return amount - remaining;
}

function removeResource(kind, amount) {
  if(kind==='gold') {settlement.gold=Math.max(0,settlement.gold-amount);syncResources();return;}
  if(kind==='food') {
    for(const food of FOOD) {if(!settlement.foodEnabled[food])continue;const take=Math.min(amount,resources[food]);if(take>0)removeResource(food,take);amount-=take;if(amount<=0)break;}
    return;
  }
  let remaining = amount;
  for (const building of buildings) {
    if(building.userData.fire)building.userData.fire.scale.y=.82+.2*Math.sin(clock.elapsedTime*11);
    if (!building.userData.stock || building.userData.ownerId!==localOwner()) continue;
    const taken = Math.min(remaining, building.userData.stock[kind]||0);
    building.userData.stock[kind] -= taken;
    if(taken>0)sendPeerAction({kind:'stock',x:building.position.x,z:building.position.z,resource:kind,amount:building.userData.stock[kind]});
    remaining -= taken;
    if (!remaining) break;
  }
  syncResources();
}

function updateStorageVisuals() {
  const stores = buildings.filter(b => b.userData.stockVisuals);
  for (const store of stores) {
    for (const kind of ['wood','stone','food']) {
      const perStore = buildingStorageCapacity(store,kind);
      if (!perStore) continue;
      const stored = kind==='food' ? FOOD.reduce((sum,item)=>sum+store.userData.stock[item],0) : store.userData.stock[kind];
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
  for(const armoury of buildings)if(armoury.userData.armouryVisuals) {
    const total=ARMOURY_ITEMS.reduce((sum,item)=>sum+(armoury.userData.stock?.[item]||0),0);
    armoury.userData.armouryVisuals.forEach((weapon,index)=>weapon.visible=index<Math.min(6,total));
  }
}

function canAfford(cost) {
  return Object.entries(cost).every(([k,v]) => (k==='gold' ? settlement.gold : resources[k]) >= v);
}
function pay(cost) {
  for (const [k,v] of Object.entries(cost)) removeResource(k,v);
  sendSettlementState();
}
const buildingChoices = Object.keys(BUILDINGS).filter(type=>type!=='house');
function showBuildCategory(category='Housing / Storage') {
  buildOptions.replaceChildren();
  buildTooltip.textContent='Point at a building to see what it does and where to place it.';
  const tabs=document.createElement('div'); tabs.className='buildTabs';
  for(const group of [...new Set(buildingChoices.map(type=>BUILDINGS[type].category))]) {
    const tab=document.createElement('button'); tab.textContent=group; tab.className=group===category?'active':'';
    tab.onclick=()=>showBuildCategory(group); tabs.append(tab);
  }
  buildOptions.append(tabs);
  const options=document.createElement('div');options.className='buildList';
  for(const type of buildingChoices.filter(type=>BUILDINGS[type].category===category)) {
    const item=BUILDINGS[type],button=document.createElement('button');
    const price=Object.entries(buildingCost(type)).map(([kind,amount])=>`${amount} ${kind}`).join(', ')||'free';
    button.textContent=`${item.name} · ${price} · ${item.workers} ${item.workers===1?'worker':'workers'}`;
    const help=BUILDING_HELP[type];
    button.title=help;
    button.setAttribute('aria-describedby','buildTooltip');
    const showHelp=()=>{buildTooltip.innerHTML=`<strong>${item.name}</strong><br>${help}<br><span class="muted">Cost: ${price} · Workers: ${item.workers}</span>`;};
    button.addEventListener('pointerenter',showHelp);
    button.addEventListener('focus',showHelp);
    button.onclick=()=>{selectBuilding(type);closeBuildMenu();};options.append(button);
  }
  buildOptions.append(options);
}
showBuildCategory();
function openBuildMenu() {
  if (!basePlaced) return toast('Place your base first');
  showBuildCategory();
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
  if (!basePlaced && type!=='house') return toast('Place your base first');
  clearSelection();
  selectedBuild = type;
  if (buildGhost) scene.remove(buildGhost);
  buildGhost = makeBuildingMesh(type,true);
  scene.add(buildGhost);
  toast(type === 'quarry' ? 'Build mode: quarry · place on a gray stone deposit' : `Build mode: ${type}`);
}
function cancelBuild() {
  if (!basePlaced) return;
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
  const ground=origin.add(dir.multiplyScalar(t));
  const planar=Math.hypot(ground.x-camera.position.x,ground.z-camera.position.z);
  if(planar<7) {const forward=new THREE.Vector3(-Math.sin(camera.rotation.y),0,-Math.cos(camera.rotation.y));ground.x=camera.position.x+forward.x*7;ground.z=camera.position.z+forward.z*7;}
  ground.y=0;return ground;
}
function updateGhost() {
  if (!buildGhost) return;
  const p=getAimGroundPoint();
  if (!p) { buildGhost.visible = false; return; }
  buildGhost.visible = true;
  const x = Math.round(p.x / GRID) * GRID;
  const z = Math.round(p.z / GRID) * GRID;
  buildGhost.position.set(x,0,z);
  const ok = isBuildingSpotFree(x,z,selectedBuild) && canAfford(buildingCost(selectedBuild)) && (selectedBuild!=='house' || findStarterStores(x,z));
  buildGhost.traverse(o => {
    if (o.material?.emissive) o.material.emissive.set(ok ? 0x143a14 : 0x481111);
  });
}

function placeBuilding() {
  if (!selectedBuild || !buildGhost?.visible) return;
  const {x,z} = buildGhost.position;
  if (!basePlaced) {
    if (selectedBuild!=='house') return;
    if (!sandboxMode && multiplayer.sectorCount>=2 && !footprintInSector(x,z,...BUILDINGS.house.footprint,multiplayer.sectorAngle,multiplayer.sectorCount)) return toast('Place your base inside your highlighted map sector');
    const storage=findStarterStores(x,z);
    if (!isBuildingSpotFree(x,z,'house') || !storage) return toast('Choose a clear area for your base and stores');
    if (!sandboxMode && multiplayer.sectorCount>=2 && !startingBaseInSector(x,z,storage,multiplayer.sectorAngle,multiplayer.sectorCount)) return toast('Keep your base and stores inside your map sector');
    placeStarterBase(x,z,multiplayer.playerId||'sandbox',true,storage);
    cancelBuild();
    return;
  }
  if (!isBuildingSpotFree(x,z,selectedBuild)) return toast(selectedBuild === 'quarry' ? 'Build the quarry on an empty stone deposit' : 'Blocked tile');
  const cost = buildingCost(selectedBuild);
  if (!canAfford(cost)) return toast('Not enough resources');
  pay(cost);
  sendPeerAction({kind:'build',buildingType:selectedBuild,x,z});
  createBuilding(selectedBuild,x,z,multiplayer.playerId||'sandbox');
  playSound('build',.2);
  toast(`${selectedBuild} built`);
}

function findStarterStores(x,z) {
  const candidates=[];
  for (let radius=1;radius<=3;radius++) {
    for (let dx=-radius;dx<=radius;dx++) for (let dz=-radius;dz<=radius;dz++) {
      if (Math.max(Math.abs(dx),Math.abs(dz))!==radius) continue;
      const sx=x+dx*GRID, sz=z+dz*GRID;
      if (isBuildingSpotFree(sx,sz,'stockpile') && Math.hypot(sx-x,sz-z)>=GRID) candidates.push({x:sx,z:sz});
    }
    if (candidates.length>=2) break;
  }
  const first=candidates[0];
  const second=first && candidates.find(spot => spot!==first && (Math.abs(spot.x-first.x)>=GRID || Math.abs(spot.z-first.z)>=GRID));
  return first && second ? {stockpile:first,granary:second} : null;
}

function placeStarterBase(x,z,ownerId,replicate,storage) {
  if (!storage?.stockpile || !storage?.granary || ![x,z,storage.stockpile.x,storage.stockpile.z,storage.granary.x,storage.granary.z].every(Number.isFinite)) return;
  if (Math.hypot(x,z)>WORLD_RADIUS-4 || buildings.some(building => building.userData.type==='house' && dist2D(building.position,{x,z})<1)) return;
  const house=createBuilding('house',x,z,ownerId);
  const stockpile=createBuilding('stockpile',storage.stockpile.x,storage.stockpile.z,ownerId);
  const granary=createBuilding('granary',storage.granary.x,storage.granary.z,ownerId);
  if(ownerId===localOwner()) {
    addResource('wood',40,stockpile);
    addResource('meat',30,granary);
    settlement.population=POPULARITY.initialPeasants;
    settlement.idlePeasants=POPULARITY.initialPeasants;
    for(let i=0;i<POPULARITY.initialPeasants;i++) {
      const peasant=makeNPC('peasant',spawnPosition(house));peasant.userData.ownerId=ownerId;peasant.userData.home=house;
      peasant.userData.id=`${ownerId}-peasant-${i}`;
      house.userData.units.push(peasant);
    }
  } else {
    stockpile.userData.stock.wood=40;granary.userData.stock.meat=30;
    for(let i=0;i<POPULARITY.initialPeasants;i++) {const peasant=makeNPC('peasant',spawnPosition(house));peasant.userData.id=`${ownerId}-peasant-${i}`;peasant.userData.ownerId=ownerId;peasant.userData.home=house;house.userData.units.push(peasant);}
  }
  if (replicate) sendPeerAction({kind:'base',x,z,storage});
  if (ownerId===multiplayer.playerId || ownerId==='sandbox') {
    basePlaced=true;
    basePrompt.hidden=true;
    selectedBuild=null;
    if (buildGhost) scene.remove(buildGhost);
    buildGhost=null;
    playerReady=true;
    sendPeerAction({kind:'ready'});
    playSound('build',.2);
    toast('Base established · press E to build');
  }
}

function createBuilding(type,x,z,ownerId=localOwner()) {
  const b = makeBuildingMesh(type,false);
  b.position.set(x,0,z);
  b.userData.ownerId=ownerId;
  b.userData.hp=type==='house'?400:180;
  b.userData.rotation=0;
  b.userData.footprint=logicalGrid.footprint(x,z,...(BUILDINGS[type]?.footprint||[2,2]),0,BUILDINGS[type]?.mask);
  b.userData.entranceTile=logicalGrid.tile(x+(BUILDINGS[type]?.entrance[0]||0)*TILE_SIZE,z+(BUILDINGS[type]?.entrance[1]||1)*TILE_SIZE);
  b.userData.interactionTile=logicalGrid.tile(x+(BUILDINGS[type]?.interaction[0]||0)*TILE_SIZE,z+(BUILDINGS[type]?.interaction[1]||-1)*TILE_SIZE);
  b.userData.deliveryTile=logicalGrid.tile(x+(BUILDINGS[type]?.delivery[0]||1)*TILE_SIZE,z+(BUILDINGS[type]?.delivery[1]||0)*TILE_SIZE);
  logicalGrid.occupy(b.userData.footprint,1);
  b.userData.radius = 2.0;
  b.userData.units = [];
  b.userData.rallyPoint = null;
  b.userData.attackPlayer = false;
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
  if (BUILDINGS[type]?.storage) b.userData.stock = Object.fromEntries(RESOURCES.map(kind=>[kind,0]));
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
  if(type==='ironMine') {b.userData.deposit=ironDepositAt(x,z);b.userData.deposit.mine=b;}
  if(type==='oxTether') {b.userData.mule=null;b.userData.handler=null;}
  if(RECIPES[type]) {b.userData.inputBuffer={};b.userData.outputBuffer=0;b.userData.progress=0;b.userData.recipe=RECIPES[type];b.userData.established=0;}
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
  if(ownerId===localOwner() && BUILDINGS[type]?.workers) assignWorkers(b);
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

const workerKinds={lumber:'lumberjack',hunting:'hunter',quarry:'quarryman',oxTether:'muleHandler'};
function assignWorkers(building) {
  if(building.userData.ownerId!==localOwner())return;
  const needed=BUILDINGS[building.userData.type]?.workers||0;
  while(building.userData.units.filter(n=>n.userData.kind!=='mule').length<needed && settlement.idlePeasants>0) {
    const idle=npcs.find(n=>n.userData.kind==='peasant' && n.userData.ownerId===localOwner());
    if(!idle)break;
    const position=idle.position.clone(),home=idle.userData.home;
    home.userData.units.splice(home.userData.units.indexOf(idle),1);
    scene.remove(idle);npcs.splice(npcs.indexOf(idle),1);
    const worker=makeNPC(workerKinds[building.userData.type]||'craftsman',position);
    worker.userData.job=building.userData.type;
    worker.userData.ownerId=localOwner();worker.userData.home=building;worker.userData.onboarding=true;
    worker.userData.id=crypto.randomUUID();
    building.userData.units.push(worker);
    settlement.idlePeasants--;
    sendPeerAction({kind:'worker-assigned',unitId:worker.userData.id,workerKind:worker.userData.kind,job:worker.userData.job,x:position.x,z:position.z,buildingX:building.position.x,buildingZ:building.position.z});
  }
  if(building.userData.type==='oxTether' && building.userData.units.length && !building.userData.mule) {
    const ox=makeNPC('mule',spawnPosition(building,.65));ox.userData.home=building;ox.userData.ownerId=localOwner();building.userData.mule=ox;building.userData.handler=building.userData.units[0];building.userData.units.push(ox);
    ox.userData.id=crypto.randomUUID();sendPeerAction({kind:'ox-spawn',unitId:ox.userData.id,x:ox.position.x,z:ox.position.z,buildingX:building.position.x,buildingZ:building.position.z});
  }
}

function nearestStockWith(pos,kind,ownerId=localOwner()) {
  return buildings.filter(b=>b.userData.ownerId===ownerId && (b.userData.stock?.[kind]||0)>0)
    .sort((a,b)=>dist2D(a.position,pos)-dist2D(b.position,pos))[0]||null;
}
function takeFromStore(store,kind,amount) {
  const taken=Math.min(amount,store.userData.stock[kind]||0);
  store.userData.stock[kind]-=taken;syncResources();
  if(taken>0)sendPeerAction({kind:'stock',x:store.position.x,z:store.position.z,resource:kind,amount:store.userData.stock[kind]});
  return taken;
}
function updateCraftWorker(n,dt) {
  const d=n.userData,b=d.home,recipe=b.userData.recipe;
  if(!recipe)return;
  if(d.carrying>0) {
    const kind=d.carryingKind||recipe.output,depot=nearestDepot(n.position,kind);
    d.state=depot ? `Delivering ${d.carrying} ${kind}` : 'Waiting for storage';
    if(depot && moveToward(n,depot.position,d.speed,dt,2.2)) {
      d.carrying-=addResource(kind,d.carrying,depot);
      if(!d.carrying){d.state='Delivered goods';d.carryingKind=null;}
    }
    return;
  }
  if(b.userData.extraOutput?.length) {
    const packageGoods=b.userData.extraOutput.shift();d.carrying=packageGoods.amount;d.carryingKind=packageGoods.kind;return;
  }
  if(b.userData.outputBuffer>0) {
    d.state='Collecting finished goods';
    if(moveToward(n,b.position,d.speed,dt,2.2)) {
      d.carrying=Math.min(b.userData.outputBuffer,12);
      b.userData.outputBuffer-=d.carrying;
    }
    return;
  }
  if(b.userData.outputBuffer>=24) {d.state='Output full';return;}
  if(recipe.establish && b.userData.established<recipe.establish) {
    d.state='Establishing cattle';
    if(moveToward(n,b.position,d.speed,dt,2.2)) b.userData.established+=dt;
    if(b.userData.cow)b.userData.cow.visible=b.userData.established>=recipe.establish;
    return;
  }
  const inputs=Object.entries(recipe.input||{});
  for(const [kind,amount] of inputs) {
    if((d.inputCargo?.[kind]||0)>=amount)continue;
    const store=nearestStockWith(n.position,kind);
    d.state=store ? `Collecting ${kind}` : `Waiting for ${kind}`;
    if(store && moveToward(n,store.position,d.speed,dt,2.2)) {
      d.inputCargo??={};d.inputCargo[kind]=(d.inputCargo[kind]||0)+takeFromStore(store,kind,amount-(d.inputCargo[kind]||0));
    }
    return;
  }
  d.state=`Making ${recipe.output}`;
  if(!moveToward(n,b.position,d.speed,dt,2.2))return;
  d.actionTimer+=dt*ACTIVE_PRESET.productionSpeed/1.35;
  b.userData.progress=Math.max(b.userData.progress||0,d.actionTimer/recipe.duration);
  if(d.actionTimer>=recipe.duration) {
    d.actionTimer=0;b.userData.progress=0;
    for(const [kind,amount] of inputs)d.inputCargo[kind]-=amount;
    b.userData.outputBuffer+=recipe.amount;
    playNearby(b.userData.type==='ironMine'?'mine':['bakery','mill','brewery'].includes(b.userData.type)?'build':'gather',b.position,.065);
    if(b.userData.type==='dairy') {b.userData.cycles=(b.userData.cycles||0)+1;if(b.userData.cycles%4===0)(b.userData.extraOutput??=[]).push({kind:'leather',amount:1});}
    if(b.userData.type==='ironMine' && b.userData.deposit) {b.userData.deposit.remaining=Math.max(0,b.userData.deposit.remaining-recipe.amount);if(!b.userData.deposit.remaining)b.userData.recipe=null;}
  }
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
  const colors = { peasant:0xb1a078,craftsman:0x8b7354,lumberjack:0x3d6ca8, hunter:0x7d5c2c, quarryman:0x686f77, muleHandler:0x816746, swordsman:0x3f3f46, archer:0x557344,spearman:0x7b8553,maceman:0x8d4b43,crossbowman:0x4a6278,pikeman:0x657784,slave:0x937359,slinger:0x866a47,assassin:0x343444,arabianArcher:0xc49c54,horseArcher:0xb68d4c,arabianSwordsman:0xa97654,fireThrower:0xaa493b };
  const eyeMat = new THREE.MeshBasicMaterial({ color:0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color:0x171b16 });
  if (kind !== 'mule') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28,.75,4,8),new THREE.MeshLambertMaterial({color:colors[kind]||0x8b7354}));
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
  if(['spearman','pikeman'].includes(kind)) {
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,kind==='pikeman'?2.8:2.2,6),wood);pole.position.set(.38,1.3,.22);
    const tip=new THREE.Mesh(new THREE.ConeGeometry(.11,.38,6),steel);tip.position.set(.38,kind==='pikeman'?2.9:2.6,.22);model.add(pole,tip);
  }
  if(['maceman','arabianSwordsman','assassin','slave'].includes(kind)) {
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.8,6),wood);handle.position.set(.38,.82,.25);
    const head=new THREE.Mesh(kind==='maceman'?new THREE.DodecahedronGeometry(.15,0):new THREE.BoxGeometry(.1,.55,.1),steel);head.position.set(.38,1.26,.25);model.add(handle,head);
  }
  if(['crossbowman','slinger','arabianArcher','horseArcher','fireThrower'].includes(kind)) {
    const weapon=new THREE.Mesh(new THREE.BoxGeometry(.75,.12,.18),kind==='fireThrower'?new THREE.MeshLambertMaterial({color:0xc74327}):wood);weapon.position.set(.4,.85,.35);model.add(weapon);
  }
  if(['pikeman','swordsman','maceman','crossbowman'].includes(kind)) {
    const armour=new THREE.Mesh(new THREE.BoxGeometry(.68,.6,.52),new THREE.MeshLambertMaterial({color:kind==='maceman'||kind==='crossbowman'?0x70563e:0x9ca6ac}));armour.position.y=.85;model.add(armour);
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
  const maxHp = UNITS[kind]?.hp || (kind==='mule' ? 70 : 50);
  g.userData = {
    kind, state:'idle', target:null, carrying:0, carryingLog:false, logsAtCamp:0, hp:maxHp, maxHp, alive:true,
    actionTimer:0, home:null, patrolTarget:null, sleeping:false, insideHome:false, attacking:false, mining:false, model, bar, barFill, sleepMarker, carriedLogs, axe, pickaxe, carriedStone, workerHands, stonePacks, muleLegs,
    animationTime:rand(0,6), speed: UNITS[kind]?.speed || (kind==='muleHandler' ? 3.8 : kind==='mule' ? 2.4 : 3.2*ACTIVE_PRESET.workerMoveSpeedModifier)
  };
  addSelectionArrow(g, kind==='mule' ? 2.9 : 2.45);
  scene.add(g);
  npcs.push(g);
  return g;
}

function activatePvE(replicate=false) {
  if(pveCamps.length)return;
  for(let i=0;i<6;i++) {
    const deposit=ironDeposits[i*2%ironDeposits.length];
    if(deposit)createPvECamp(deposit.position.x+8,deposit.position.z+8,i,replicate);
  }
}
function createPvECamp(x,z,index,replicate=false) {
  if(pveCamps.some(c=>c.index===index))return;
  const group=new THREE.Group();group.position.set(x,0,z);
  const mat=new THREE.MeshLambertMaterial({color:0x894934});
  const tent=new THREE.Mesh(new THREE.ConeGeometry(4,4,5),mat);tent.position.y=2;group.add(tent);
  const flag=new THREE.Mesh(new THREE.BoxGeometry(.8,.5,.08),new THREE.MeshLambertMaterial({color:0xb83128}));flag.position.set(0,5.1,0);group.add(flag);
  scene.add(group);
  const camp={index,position:group.position,group,units:[],cleared:false,raidTimer:240+index*20};pveCamps.push(camp);
  for(let i=0;i<4;i++) {
    const kind=i===0?'maceman':i===1?'archer':'spearman';
    const unit=makeNPC(kind,new THREE.Vector3(x+(i-1.5)*3,0,z+5));
    unit.userData.id=`pve-${index}-${i}`;unit.userData.ownerId='pve';unit.userData.camp=camp;unit.userData.guardPoint=group.position.clone();
    camp.units.push(unit);
  }
  if(replicate)sendPeerAction({kind:'pve-camp',x,z,index});
}

function recruitSoldier(kind, building) {
  const config=UNITS[kind];
  if(!config||!building||building.userData.ownerId!==localOwner()||(config.mercenary ? building.userData.type!=='mercenaryPost' : building.userData.type!=='barracks'))return;
  if(settlement.gold<config.goldCost)return toast('Not enough gold');
  if(!config.mercenary) {
    if(settlement.idlePeasants<1)return toast('No idle peasant available');
    if(!canAfford(config.equipment))return toast('Equipment missing from armoury');
    const idle=npcs.find(n=>n.userData.kind==='peasant'&&n.userData.ownerId===localOwner());
    if(!idle)return;
    idle.userData.home.userData.units.splice(idle.userData.home.userData.units.indexOf(idle),1);
    scene.remove(idle);npcs.splice(npcs.indexOf(idle),1);settlement.idlePeasants--;
    pay(config.equipment);
  }
  settlement.gold-=config.goldCost;syncResources();
  const npc = makeNPC(kind, spawnPosition(building));
  npc.userData.home = building;
  npc.userData.id=crypto.randomUUID();
  npc.userData.ownerId=multiplayer.playerId || 'sandbox';
  building.userData.units.push(npc);
  updateSelectionArrows();
  sendPeerAction({kind:'recruit',unit:kind,unitId:npc.userData.id,x:building.position.x,z:building.position.z,buildingType:building.userData.type});
  playSound('train',.2);
  toast(`${kind} recruited`);
  updateDetails();
}

function setRallyPoint(building, point, replicate=true, attackPlayer=false) {
  if(replicate&&building.userData.ownerId!==localOwner())return;
  const pos = clampToWorld(point.clone(), 3);
  building.userData.rallyPoint = pos;
  building.userData.attackPlayer = attackPlayer;
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
  if (replicate) sendPeerAction({kind:'rally',x:building.position.x,z:building.position.z,rallyX:pos.x,rallyZ:pos.z,attackPlayer});
  toast(attackPlayer ? 'Troops ordered to attack the rival king' : 'Barracks rally point assigned');
}

function nearestAlive(arr, pos, max=Infinity) {
  let best=null, bd=max;
  for (const o of arr===trees&&Number.isFinite(max)?treeHash.nearby(pos,max):arr) {
    if (!o.userData.alive || o.userData.insideHome) continue;
    const d=dist2D(o.position,pos);
    if (d<bd) {bd=d; best=o;}
  }
  return best;
}
function availableStorage(kind) {
  const item=kind==='food'?'meat':kind;
  const cap=buildings.filter(b=>b.userData.ownerId===localOwner()&&buildingStorageCapacity(b,item)>0).reduce((sum,b)=>{
    const compatible=b.userData.type==='granary'?FOOD:b.userData.type==='armoury'?ARMOURY_ITEMS:STOCKPILE_ITEMS;
    return sum+Math.max(0,buildingStorageCapacity(b,item)-compatible.reduce((used,k)=>used+(b.userData.stock[k]||0),0));
  },0);
  const workerKind={wood:'lumberjack',food:'hunter',stone:'mule'}[kind];
  const workersWithCargo=npcs.reduce((sum,n) => sum + (n.userData.kind===workerKind ? n.userData.carrying : 0),0);
  return Math.max(0,cap-workersWithCargo);
}

function killDeerForHunter(animal,hunter) {
  if(multiplayer.peers.size)sendPeerAction({kind:'deer-kill',id:animal.userData.id});
  playNearby('hit',animal.position,.08);
  animal.userData.alive=false;
  if (selectedObject===animal) clearSelection();
  animal.userData.selectionArrow.visible=false;
  for (const pupil of animal.userData.pupils) pupil.visible=false;
  for (const cross of animal.userData.crosses) cross.visible=true;
  const index=deer.indexOf(animal);
  if (index>=0) deer.splice(index,1);
  animal.rotation.z=Math.PI/2;
  animal.position.y=.45;
  hunter.userData.carcassTarget=animal;
}
function updateRemoteWildlife(states) {
  if(!Array.isArray(states))return;
  for(const state of states.slice(0,100)) {
    const animal=deer.find(item=>item.userData.id===state.id);
    if(!animal||!Number.isFinite(state.x)||!Number.isFinite(state.z))continue;
    animal.position.set(state.x,0,state.z);animal.userData.hp=state.hp;
  }
}
function nearestDepot(pos, kind) {
  const item=kind==='food'?'meat':kind;
  const candidates = buildings.filter(b => b.userData.ownerId===localOwner() && buildingStorageCapacity(b,item)>0 && (b.userData.type==='granary' ? FOOD : b.userData.type==='armoury' ? ARMOURY_ITEMS : STOCKPILE_ITEMS).reduce((sum,k)=>sum+(b.userData.stock[k]||0),0)<buildingStorageCapacity(b,item));
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
      const route=logicalGrid.findPath(obj.position,goal).map(point=>new THREE.Vector3(point.x,0,point.z));
      nav.navPath=route.length ? [...route,goal] : routeAroundBuildings(obj.position,goal,radius);
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
  if (!d.target?.userData.alive || targetClaimedByAnother(d.target,n,npcs)) d.target=nearestUnclaimedTarget(trees,n,npcs);
  if (!d.target) { returnWorkerHome(n,dt,'no unclaimed trees'); return; }
  wakeWorker(n);
  const arrived = moveToward(n,d.target.position,d.speed,dt,1.2);
  d.state = arrived ? 'Chopping a tree' : 'Walking to a tree';
  if (arrived) {
    d.actionTimer += dt;
    if (d.actionTimer > WORKER_CYCLES.woodChopPerLog) {
      d.actionTimer=0;
      d.target.userData.logsRemaining--;
      if (d.target.userData.logsRemaining<=0) {
        hideTree(d.target);
      } else {
        const remaining=d.target.userData.logsRemaining/TREE_LOGS;
        setTreeCrownScale(d.target,.55+.45*remaining);
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
  if(d.carcassTarget) {
    wakeWorker(n);
    d.state='Walking to deer carcass';
    if(moveToward(n,d.carcassTarget.position,d.speed,dt,1.2)) {
      d.state='Butchering deer';d.actionTimer+=dt;
      if(d.actionTimer>=4) {
        d.actionTimer=0;const animal=d.carcassTarget;d.carcassTarget=null;
        scene.remove(animal);animal.position.set(0,1.3,.05);animal.rotation.set(0,0,0);animal.scale.setScalar(.72);
        d.model.add(animal);d.carcass=animal;d.carrying=MEAT_PER_DEER;
      }
    }
    return;
  }
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
  if (!d.target?.userData.alive || targetClaimedByAnother(d.target,n,npcs)) d.target=nearestUnclaimedTarget(deer,n,npcs);
  if (!d.target) { returnWorkerHome(n,dt,'no unclaimed deer'); return; }
  wakeWorker(n);
  const arrived = moveToward(n,d.target.position,d.speed+0.4,dt,6.5);
  d.attacking=arrived;
  d.state = arrived ? 'Shooting a deer' : 'Tracking a deer';
  if (arrived) {
    n.rotation.y=Math.atan2(d.target.position.x-n.position.x,d.target.position.z-n.position.z);
    d.actionTimer+=dt;
    if (d.actionTimer>1.1) {
      d.actionTimer=0;
      d.target.userData.hp-=10;
      playNearby('bow',n.position,.1);
      if (d.target.userData.hp<=0) {
        killDeerForHunter(d.target,n);
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
      const amount=Math.min(d.carrying,24-home.userData.stoneBuffer);
      home.userData.stoneBuffer+=amount;
      d.carrying-=amount;
      if (!d.carrying) { d.target=null; d.state='Stone added to quarry pile'; }
    }
    return;
  }
  const reserved=home.userData.units.reduce((total,unit) => total + (unit!==n && unit.userData.kind==='quarryman' && unit.userData.carrying>0 ? 1 : 0),0);
  if (home.userData.stoneBuffer+reserved+1>24) { returnWorkerHome(n,dt,'quarry pile full'); return; }
  if (!d.target?.userData.alive || d.target.userData.deposit!==home.userData.deposit) d.target=nearestAlive(home.userData.deposit.rocks,n.position);
  if (!d.target) { returnWorkerHome(n,dt,'no stone in range'); return; }
  wakeWorker(n);
  const arrived=moveToward(n,d.target.position,d.speed,dt,1.5);
  d.state=arrived ? 'Mining stone' : 'Walking to stone';
  d.mining=arrived;
  if (arrived) {
    d.actionTimer+=dt;
    if (d.actionTimer>=QUARRY_MINING_TIME*1.35/ACTIVE_PRESET.productionSpeed) {
      d.actionTimer=0;
      d.target.userData.stoneRemaining-=1;
      if (d.target.userData.stoneRemaining<=0) {
        hideRock(d.target);
      } else setRockScale(d.target,.55+.45*d.target.userData.stoneRemaining/40);
      d.carrying=1;
      d.target=null;
    }
  } else d.actionTimer=0;
}

function updateMule(n,dt) {
  const d=n.userData;
  const home=d.home;
  const handler=home.userData.handler;
  const quarry=d.quarry?.userData.stoneBuffer>0 ? d.quarry : buildings.filter(b=>b.userData.type==='quarry'&&b.userData.ownerId===d.ownerId&&b.userData.stoneBuffer>0).sort((a,b)=>dist2D(a.position,home.position)-dist2D(b.position,home.position))[0];
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
    d.state='Returning to ox tether';
    if (moveToward(n,workerRestSpot(n),d.speed,dt,.2)) {d.returning=false;d.quarry=null;}
    return;
  }
  if(!quarry){d.state='Waiting for quarry stone';moveToward(n,workerRestSpot(n),d.speed,dt,.2);return;}
  d.quarry=quarry;
  d.state=`Walking to quarry (${quarry.userData.stoneBuffer} stone)`;
  if(moveToward(n,quarry.position,d.speed,dt,2.3)) {
    d.carrying=Math.min(MULE_LOAD,quarry.userData.stoneBuffer,availableStorage('stone'));
    quarry.userData.stoneBuffer-=d.carrying;
    d.state=d.carrying ? `Loaded ${d.carrying} stone` : 'Waiting for storage';
  }
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
  if(d.ownerId==='pve' && multiplayer.peers.size&&!multiplayer.isHost)return;
  if(d.ownerId!=='pve'&&d.ownerId!==localOwner())return;
  const config=UNITS[d.kind],reach=config.range,order=d.order||d.home?.userData.order||'guard',aggro=order==='hold'?reach+1:order==='attackMove'?Math.max(18,reach+8):Math.max(9,reach+5);
  const hostile=npcs.filter(other=>other!==n&&other.userData.alive&&other.userData.ownerId&&other.userData.ownerId!==d.ownerId&&other.userData.kind!=='mule');
  let target=nearestAlive(hostile,n.position,aggro);
  if(!target)target=buildings.filter(b=>b.userData.ownerId!==d.ownerId && (d.ownerId==='pve'||b.userData.ownerId!=='pve') && dist2D(b.position,n.position)<aggro).sort((a,b)=>dist2D(a.position,n.position)-dist2D(b.position,n.position))[0]||null;
  const rivalKings=d.ownerId==='pve' ? activePeers().filter(peer=>peer.ready&&peer.remote).map(peer=>peer.remote) : activePeers().filter(peer=>peer.ready&&peer.remote).map(peer=>peer.remote);
  for(const rival of rivalKings) if(dist2D(rival.position,n.position)<aggro && (!target||dist2D(rival.position,n.position)<dist2D(target.position,n.position)))target=rival;
  if(d.ownerId==='pve'&&basePlaced&&playerReady&&dist2D(camera.position,n.position)<aggro && (!target||dist2D(camera.position,n.position)<dist2D(target.position,n.position)))target=camera;
  if(d.home?.userData.attackPlayer && d.ownerId!=='pve') {
    const rival=rivalKings.find(king=>dist2D(king.position,n.position)<60);
    if(rival)target=rival;
  }
  if(order==='retreat')target=null;
  if (target) {
    const isPlayer=target===camera||rivalKings.includes(target);
    d.state=isPlayer ? 'Attacking a lord' : target.userData.type ? `Raiding ${target.userData.type}` : `Fighting ${target.userData.kind}`;
    const distance=dist2D(target.position,n.position);
    if (distance>reach) moveToward(n,target.position,d.speed,dt,reach*.82);
    n.rotation.y=Math.atan2(target.position.x-n.position.x,target.position.z-n.position.z);
    d.attacking=distance<=reach;
    if (d.attacking) {
      d.actionTimer+=dt;
      if (d.actionTimer >= config.cooldown) {
        d.actionTimer=0;
        const armour=isPlayer||target.userData.type?0:UNITS[target.userData.kind]?.armour||0;
        const meleePenalty=config.range>3&&distance<2 ? .5 : 1;
        const amount=Math.max(1,Math.round(config.damage*meleePenalty)-Math.max(0,armour-(config.penetration||0)));
        playNearby(reach>3 ? 'bow' : 'sword',n.position,.16);
        if(target===camera)damagePlayer(amount);
        else if(isPlayer)resolveHit(target,amount,d.kind,d.id);
        else if(target.userData.type)resolveBuildingHit(target,amount,d.id);
        else resolveHit(target,amount,d.kind,d.id);
      }
    }
    return;
  }
  d.attacking=false;
  d.actionTimer=0;
  const center = d.ownerId==='pve' ? d.raidTarget||d.guardPoint : order==='follow'?camera.position:order==='retreat'?buildings.find(b=>b.userData.type==='house'&&b.userData.ownerId===d.ownerId)?.position:d.home?.userData.rallyPoint || d.orphanRally;
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

function killNPC(n,suppressReplacement=false) {
  if(n.userData.ownerId===localOwner() && n.userData.kind!=='mule' && !UNITS[n.userData.kind]?.mercenary) {
    settlement.population=Math.max(0,settlement.population-1);
    if(n.userData.kind==='peasant')settlement.idlePeasants=Math.max(0,settlement.idlePeasants-1);
  }
  n.userData.alive=false;
  if(n.userData.ownerId===localOwner()&&n.userData.carrying>0) {
    const kind=n.userData.kind==='lumberjack'?'wood':n.userData.kind==='hunter'?'meat':['quarryman','mule'].includes(n.userData.kind)?'stone':n.userData.carryingKind||n.userData.home?.userData.recipe?.output;
    if(kind)dropPackage(n.position,kind,n.userData.carrying);
  }
  if(n.userData.camp) {
    const camp=n.userData.camp;
    camp.units=camp.units.filter(unit=>unit!==n);
    if(!camp.units.length&&!camp.cleared) {
      camp.cleared=true;scene.remove(camp.group);
      if(!multiplayer.peers.size||multiplayer.isHost) {
        const candidates=[{id:localOwner(),position:camera.position},...activePeers().filter(peer=>peer.remote).map(peer=>({id:peer.id,position:peer.remote.position}))].sort((a,b)=>dist2D(a.position,camp.position)-dist2D(b.position,camp.position));
        const victor=candidates[0];
        if(victor&&dist2D(victor.position,camp.position)<90) {
          if(victor.id===localOwner()){settlement.gold+=75;addResource('meat',10);const stored=addResource('spear',2);if(stored<2)dropPackage(camp.position,'spear',2-stored);syncResources();toast('Bandit camp cleared: gold and supplies');}
          else sendPeerAction({kind:'pve-reward',targetId:victor.id,x:camp.position.x,z:camp.position.z});
        }
      }
    }
  }
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
  if(!suppressReplacement&&n.userData.job&&n.userData.home?.userData.ownerId===localOwner())assignWorkers(n.userData.home);
  updateSelectionArrows();
}

function updateNPCVisuals(dt) {
  for (const n of npcs) {
    const d=n.userData;
    d.animationTime+=dt;
    if (d.lastAudioPosition && dist2D(n.position,d.lastAudioPosition)>.12 && !d.insideHome && clock.elapsedTime-(d.lastFootstepAt||0)>.96) {
      playNearby('step',n.position,.045);
      d.lastFootstepAt=clock.elapsedTime;
    }
    if(d.lastAudioPosition)d.lastAudioPosition.copy(n.position);
    else d.lastAudioPosition=n.position.clone();
    if (d.mining && clock.elapsedTime-(d.lastWorkSoundAt||0)>1.8) {
      playNearby('mine',n.position,.075);
      d.lastWorkSoundAt=clock.elapsedTime;
    }
    if (d.kind==='lumberjack' && d.state==='Chopping a tree' && clock.elapsedTime-(d.lastWorkSoundAt||0)>1.7) {
      playNearby('chop',n.position,.09);
      d.lastWorkSoundAt=clock.elapsedTime;
    }
    const sleepTarget=d.sleeping ? -Math.PI/2 : 0;
    d.model.rotation.z=THREE.MathUtils.damp(d.model.rotation.z,sleepTarget,8,dt);
    if (d.kind==='swordsman' || d.kind==='archer') d.model.rotation.x=THREE.MathUtils.damp(d.model.rotation.x,d.attacking ? Math.sin(d.animationTime*13)*.12 : 0,12,dt);
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
      if(d.lastVisualPosition)d.lastVisualPosition.copy(n.position);
      else d.lastVisualPosition=n.position.clone();
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
    if(building.userData.sails)building.userData.sails.rotation.z+=dt*.5;
    if(building.userData.crops && building.userData.type==='wheatFarm') for(const crop of building.userData.crops) crop.scale.y=.15+.85*Math.min(1,building.userData.progress||0);
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
  for (const n of npcs) {
    if(n.userData.ownerId && n.userData.ownerId!==localOwner() && !(n.userData.ownerId==='pve'&&(!multiplayer.peers.size||multiplayer.isHost)))continue;
    if(n.userData.onboarding) {
      n.userData.state='Traveling to work';
      if(moveToward(n,n.userData.home.position,n.userData.speed,dt,2.5))n.userData.onboarding=false;
      continue;
    }
    if (n.userData.kind==='lumberjack') updateLumberjack(n,dt);
    if (n.userData.kind==='hunter') updateHunter(n,dt);
    if (n.userData.kind==='quarryman') updateQuarryman(n,dt);
    if (n.userData.kind==='mule') updateMule(n,dt);
    if (n.userData.kind==='muleHandler') updateMuleHandler(n,dt);
    if (n.userData.kind==='craftsman') updateCraftWorker(n,dt);
    if (n.userData.kind==='peasant') {n.userData.state='Waiting for work';moveToward(n,n.userData.home.position,n.userData.speed,dt,rand(2,5));}
    if (isMilitary(n.userData.kind)) updateSoldier(n,dt);
  }
}

function addIdlePeasant() {
  const house=buildings.find(b=>b.userData.type==='house'&&b.userData.ownerId===localOwner());
  if(!house)return;
  const peasant=makeNPC('peasant',spawnPosition(house));
  peasant.userData.ownerId=localOwner();peasant.userData.home=house;house.userData.units.push(peasant);
  peasant.userData.id=crypto.randomUUID();sendPeerAction({kind:'peasant-arrived',unitId:peasant.userData.id,x:peasant.position.x,z:peasant.position.z,buildingX:house.position.x,buildingZ:house.position.z});
  settlement.population++;settlement.idlePeasants++;
  playNearby('train',house.position,.08);
  for(const building of buildings) if(building.userData.ownerId===localOwner()) assignWorkers(building);
}
function updateEconomy(dt) {
  if(!basePlaced||matchEnded)return;
  settlement.housingCapacity=POPULARITY.initialHousing+buildings.filter(b=>b.userData.ownerId===localOwner()&&b.userData.type==='hovel').length*8;
  settlement.foodDebt+=settlement.population/100*RATIONS[settlement.ration].multiplier*ACTIVE_PRESET.consumptionModifier*dt;
  while(settlement.foodDebt>=1) {
    settlement.foodDebt--;
    const kind=FOOD.find(food=>settlement.foodEnabled[food]&&resources[food]>=1);
    if(kind) {removeResource(kind,1);settlement.consumedTypes??=new Set();settlement.consumedTypes.add(kind);}
    else settlement.hungry=true;
  }
  settlement.monthTimer+=dt;
  if(settlement.monthTimer>=POPULARITY.monthSeconds) {
    settlement.monthTimer-=POPULARITY.monthSeconds;
    const diversity=Math.max(0,(settlement.consumedTypes?.size||0)-1);
    settlement.popularity=THREE.MathUtils.clamp(POPULARITY.base+RATIONS[settlement.ration].popularity+TAXES[settlement.tax].popularity+diversity+(settlement.hungry?-20:0),0,100);
    settlement.gold+=settlement.population*TAXES[settlement.tax].rate;
    settlement.consumedTypes=new Set();settlement.hungry=false;syncResources();sendSettlementState();
    if(settlement.popularity<50)settlement.lowPopularityTime+=POPULARITY.monthSeconds;
    else settlement.lowPopularityTime=0;
    if(settlement.lowPopularityTime>=64) {
      const civilian=npcs.find(n=>n.userData.kind==='peasant'&&n.userData.ownerId===localOwner())||npcs.find(n=>n.userData.ownerId===localOwner()&&!isMilitary(n.userData.kind)&&n.userData.kind!=='mule');
      if(civilian){sendPeerAction({kind:'civilian-left',unitId:civilian.userData.id});killNPC(civilian);settlement.lowPopularityTime=0;toast('A civilian left the settlement');}
    }
  }
  if(settlement.popularity>=50 && settlement.population<settlement.housingCapacity && settlement.idlePeasants<POPULARITY.maxIdleAtFire) {
    settlement.immigrationTimer+=dt*ACTIVE_PRESET.populationSpawnModifier;
    const interval=THREE.MathUtils.clamp(24-.4*(settlement.popularity-50),4,24);
    if(settlement.immigrationTimer>=interval){settlement.immigrationTimer=0;addIdlePeasant();}
  }
}

function updatePvE(dt) {
  if(multiplayer.peers.size&&!multiplayer.isHost)return;
  if(zone.elapsed<300)return;
  for(const camp of pveCamps) {
    if(camp.cleared)continue;
    camp.raidTimer-=dt;
    if(camp.raidTimer>0)continue;
    camp.raidTimer=Math.max(80,200-zone.phase*25);
    const target=buildings.filter(b=>b.userData.type==='house').sort((a,b)=>dist2D(a.position,camp.position)-dist2D(b.position,camp.position))[0];
    if(!target||dist2D(target.position,camp.position)>220)continue;
    for(const unit of camp.units) {unit.userData.raidTarget=target.position.clone();unit.userData.patrolTarget=null;}
    if(target.userData.ownerId===localOwner())toast('Raid warning: bandits are approaching');
  }
}

const zone={elapsed:0,phase:0,center:new THREE.Vector3(),radius:WORLD_RADIUS,nextCenter:new THREE.Vector3(),nextRadius:MATCH_PHASES[1].radius,damage:0,warning:0};
const zoneRing=new THREE.Mesh(new THREE.RingGeometry(.995,1.005,128),new THREE.MeshBasicMaterial({color:0xffb54e,side:THREE.DoubleSide,transparent:true,opacity:.62,depthWrite:false}));
zoneRing.rotation.x=-Math.PI/2;zoneRing.position.y=.07;scene.add(zoneRing);
zoneRing.visible=false;
function applyZoneState(state) {
  if(!state||!Number.isFinite(state.elapsed)||!Number.isFinite(state.radius))return;
  zone.elapsed=state.elapsed;zone.phase=state.phase;zone.radius=state.radius;
  zone.center.set(state.x||0,0,state.z||0);zone.damage=state.damage||0;
  zoneRing.position.set(zone.center.x,.07,zone.center.z);zoneRing.scale.setScalar(zone.radius);
}
let zoneSyncTimer=0;
let zoneDamageTimer=0;
function updateZone(dt) {
  if(!basePlaced||matchEnded)return;
  if(multiplayer.peers.size&&!multiplayer.isHost)return;
  zone.elapsed+=dt;
  if(sandboxMode)return;
  const nextState=zoneAt(zone.elapsed),phase=nextState.phase;
  if(phase!==zone.phase) {zone.phase=phase;toast(`${MATCH_PHASES[phase].name}: the safe zone is moving`);}
  zone.radius=nextState.radius;zone.damage=nextState.damage;zone.nextRadius=nextState.nextRadius;
  zoneRing.scale.setScalar(zone.radius);
  zoneSyncTimer+=dt;
  if(zoneSyncTimer>=1) {
    zoneSyncTimer=0;
    sendPeerAction({kind:'zone',elapsed:zone.elapsed,phase:zone.phase,radius:zone.radius,x:zone.center.x,z:zone.center.z,damage:zone.damage});
  }
  if(zone.damage>0) {
    if(dist2D(camera.position,zone.center)>zone.radius)damagePlayer(zone.damage*dt);
    for(const n of [...npcs]) if((n.userData.ownerId===localOwner()||n.userData.ownerId==='pve')&&dist2D(n.position,zone.center)>zone.radius) {
      n.userData.hp-=zone.damage*dt;if(n.userData.hp<=0)killNPC(n);
    }
    zoneDamageTimer+=dt;
    if(zoneDamageTimer>=1) {
      zoneDamageTimer-=1;
      for(const peer of activePeers())if(peer.remote&&dist2D(peer.remote.position,zone.center)>zone.radius)sendPeerAction({kind:'zone-hit',targetId:peer.id,amount:zone.damage});
      for(const n of [...npcs])if(n.userData.ownerId&&n.userData.ownerId!==localOwner()&&n.userData.ownerId!=='pve'&&dist2D(n.position,zone.center)>zone.radius){damageUnit(n.userData.id,zone.damage);sendPeerAction({kind:'unit-hit',unitId:n.userData.id,amount:zone.damage,weapon:'zone'});}
    }
  }
}

function updateWildlife(dt) {
  if(multiplayer.peers.size&&!multiplayer.isHost)return;
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

}

function collidesBuilding(pos) {
  return blockedByBuilding(pos,PLAYER_RADIUS);
}

function updatePlayer(dt) {
  if (!canPlay()) return;
  const before=camera.position.clone();
  const forwardInput=Number(!!keys.KeyW)-Number(!!keys.KeyS);
  const sideInput=Number(!!keys.KeyD)-Number(!!keys.KeyA);
  if (sprintExhausted && playerStamina>=25) sprintExhausted=false;
  const sprinting=!!(forwardInput || sideInput) && !!(keys.ShiftLeft || keys.ShiftRight) && !sprintExhausted && playerStamina>0;
  playerStamina=THREE.MathUtils.clamp(playerStamina+(sprinting ? -25 : 17)*dt,0,100);
  if (playerStamina===0) sprintExhausted=true;
  if (forwardInput || sideInput) {
    const forward=new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y=0;
    forward.normalize();
    const right=forward.clone().cross(new THREE.Vector3(0,1,0));
    const movement=forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput)).normalize();
    const distance=WALK_SPEED*(sprinting ? SPRINT_MULTIPLIER : 1)*dt;
    const canMoveTo=pos => Math.hypot(pos.x,pos.z)<WORLD_RADIUS-1.1 && !collidesBuilding(pos);
    const xStep=camera.position.clone();
    xStep.x+=movement.x*distance;
    if (canMoveTo(xStep)) camera.position.x=xStep.x;
    const zStep=camera.position.clone();
    zStep.z+=movement.z*distance;
    if (canMoveTo(zStep)) camera.position.z=zStep.z;
  }
  if (grounded) {
    footstepDistance+=dist2D(before,camera.position);
    if (footstepDistance>.9 && clock.elapsedTime-lastPlayerFootstepAt>.24) {
      playSound('step',keys.ShiftLeft || keys.ShiftRight ? .12 : .075);
      lastPlayerFootstepAt=clock.elapsedTime;
      footstepDistance=0;
    }
  }

  if (jumpRequested && grounded) {
    verticalVelocity=JUMP_SPEED;
    grounded=false;
    playSound('jump',.1);
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
  for(const pack of [...droppedPackages])if(dist2D(camera.position,pack.mesh.position)<1.6) {
    if(availableStorage(pack.kind)<=0)continue;
    const stored=addResource(pack.kind,pack.amount);
    pack.amount-=stored;
    if(pack.amount<=0){scene.remove(pack.mesh);droppedPackages.splice(droppedPackages.indexOf(pack),1);toast(`Recovered ${stored} ${pack.kind}`);}
  }
}

function swordAttack() {
  if (matchEnded || performance.now()-lastSwordAttack<650) return false;
  lastSwordAttack=performance.now();
  swordSwingTime=.38;
  playSound('sword',.22);
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  dir.y=0;
  dir.normalize();
  let best=null, bestScore=999;
  const enemyUnits=npcs.filter(unit => unit.userData.alive && unit.userData.ownerId && unit.userData.ownerId!==multiplayer.playerId && unit.userData.ownerId!=='sandbox');
  const rivalKings=combatReady() ? activePeers().filter(peer => peer.ready && peer.remote).map(peer => peer.remote) : [];
  for (const r of [...enemyUnits,...rivalKings]) {
    const to=r.position.clone().sub(camera.position);
    to.y=0;
    const dist=to.length();
    if (dist>3.7) continue;
    to.normalize();
    if (dir.dot(to)>(dist<2.2 ? -.15 : .45) && dist<bestScore) {best=r; bestScore=dist;}
  }
  if (best) {
    resolveHit(best,20,'swordsman',null);
    toast('Sword hit');
    return true;
  }
  return false;
}

function selectionBuilding() {
  if (!selectedObject) return null;
  if (selectedObject.userData.type) return selectedObject;
  return selectedObject.userData.home;
}

function updateSelectionArrows() {
  for (const obj of [...buildings, ...npcs, ...deer]) obj.userData.selectionArrow.visible = false;
  for (const b of buildings) if (b.userData.rangeIndicator) b.userData.rangeIndicator.visible=false;
  if(allMilitarySelected){for(const building of buildings)if(building.userData.ownerId===localOwner()&&['barracks','mercenaryPost'].includes(building.userData.type)){building.userData.selectionArrow.visible=true;for(const unit of building.userData.units)unit.userData.selectionArrow.visible=true;}return;}
  if (!selectedObject) return;
  selectedObject.userData.selectionArrow.visible = true;
  const building = selectionBuilding();
  if (building) {
    building.userData.selectionArrow.visible = true;
    for (const unit of building.userData.units) unit.userData.selectionArrow.visible = true;
    if (selectedObject===building && building.userData.rangeIndicator) building.userData.rangeIndicator.visible=true;
  }
}

function releaseWorker(unit) {
  const owner=unit.userData.ownerId;
  const house=buildings.find(b=>b.userData.type==='house'&&b.userData.ownerId===owner);
  if(!house){killNPC(unit,true);return;}
  const position=unit.position.clone(),home=unit.userData.home;
  home?.userData.units.splice(home.userData.units.indexOf(unit),1);
  scene.remove(unit);npcs.splice(npcs.indexOf(unit),1);
  const peasant=makeNPC('peasant',position);peasant.userData.ownerId=owner;peasant.userData.home=house;house.userData.units.push(peasant);
  if(owner===localOwner())settlement.idlePeasants++;
}

function demolishSelectedBuilding(target=selectedObject, replicate=true, destroyed=false) {
  const b=target?.userData.type ? target : null;
  if (!b || (b.userData.type==='house'&&!destroyed)) return toast('Select an outpost to dismantle');
  if(replicate&&b.userData.ownerId!==localOwner())return toast('That is not your building');
  const refund=Object.fromEntries(Object.entries(costs[b.userData.type]).map(([kind,amount]) => [kind,Math.floor(amount/2)]));
  const contents=b.userData.stock ? {...b.userData.stock} : b.userData.type==='quarry' ? {stone:b.userData.stoneBuffer} : null;
  if(!destroyed && contents && RESOURCES.some(kind=>(contents[kind]||0)>0 && buildings.reduce((room,other)=>other!==b&&other.userData.ownerId===b.userData.ownerId?room+Math.max(0,buildingStorageCapacity(other,kind)-(other.userData.stock?.[kind]||0)):room,0)<contents[kind]))return toast('Build another store before dismantling this one');
  if (replicate) sendPeerAction({kind:'demolish',x:b.position.x,z:b.position.z});
  for (const unit of [...b.userData.units]) {
    if (b.userData.type==='barracks') {
      unit.userData.orphanRally=b.userData.rallyPoint?.clone() || b.position.clone();
      unit.userData.home=null;
    } else if(unit.userData.kind==='mule')killNPC(unit,true);
    else releaseWorker(unit);
  }
  if (b.userData.rallyMarker) scene.remove(b.userData.rallyMarker);
  if (b.userData.rangeIndicator) scene.remove(b.userData.rangeIndicator);
  if (b.userData.muleLead) scene.remove(b.userData.muleLead);
  if (b.userData.deposit) b.userData.deposit.quarry=null;
  if(b.userData.deposit?.mine===b)b.userData.deposit.mine=null;
  logicalGrid.occupy(b.userData.footprint||[],0);
  scene.remove(b);
  buildings.splice(buildings.indexOf(b),1);
  if (b===selectedObject) clearSelection();
  if (contents&&!destroyed) {
    for (const kind of RESOURCES) if(contents[kind]>0)addResource(kind,contents[kind]);
  }
  const refunded=destroyed?[]:Object.entries(refund).map(([kind,amount]) => `${addResource(kind,amount)} ${kind}`).filter(label => !label.startsWith('0 '));
  updateStorageVisuals();
  toast(`${destroyed?'Building destroyed':'Outpost dismantled'}${refunded.length ? `: +${refunded.join(', ')}` : ''}`);
}

function clearSelection() {
  allMilitarySelected=false;
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
    detailTitle.textContent = BUILDINGS[type]?.name||type;
    if (type === 'barracks') {
      const rally = b.userData.rallyPoint;
      detailBody.textContent = `Troops: ${b.userData.units.length}\nRally: ${rally ? `${Math.round(rally.x)}, ${Math.round(rally.z)}` : 'not assigned'}\nOrder: ${b.userData.attackPlayer ? 'Pursue rival king' : 'Patrol'}\nLook at ground and press Q to rally, or aim at rival king and press Q to attack.`;
    } else if (type === 'quarry') {
      const miners=b.userData.units.filter(unit => unit.userData.kind==='quarryman');
      const mule=b.userData.mule;
      const handler=b.userData.handler;
      detailBody.textContent=`Work range: ${WORK_RANGE.quarry} m\nMiners: ${miners.length} · ${QUARRY_MINING_TIME}s per load\nStone at quarry: ${b.userData.stoneBuffer} / ${MULE_LOAD}\nMule: ${mule ? `${mule.userData.state}${mule.userData.carrying ? ` (${mule.userData.carrying} stone)` : ''}` : 'Returning soon'}\nHandler: ${handler?.userData.state || 'Returning soon'}\n${miners.map((miner,index) => `Miner ${index+1}: ${miner.userData.state}`).join('\n')}`;
    } else if (type === 'lumber' || type === 'hunting') {
      const worker = b.userData.units[0];
      const workerName={lumber:'Lumberjack',hunting:'Hunter'}[type];
      const resource={lumber:'wood',hunting:'food'}[type];
      detailBody.textContent = `Work range: whole map (nearest unclaimed target)\nWorkers: ${b.userData.units.length}\n${worker ? `${workerName}: ${worker.userData.state}\nCarrying: ${worker.userData.carryingLog ? '1 log' : `${worker.userData.carrying} ${resource}`}` : 'Worker lost'}`;
    } else {
      detailBody.textContent = b.userData.stock ? Object.entries(b.userData.stock).filter(([,value])=>value>0).map(([kind,value])=>`${kind}: ${Math.floor(value)}`).join('\n')||'Empty storage' : type==='hovel' ? 'Housing for 8 people.' : type==='house' ? 'The settlement headquarters and idle peasant campfire.' : type==='market' ? 'Open Tab Stores to buy and sell goods.' : 'Waiting for workers or resources.';
    }
    if(BUILDINGS[type]?.workers) {
      const workers=b.userData.units.filter(unit=>unit.userData.kind!=='mule');
      const recipe=b.userData.recipe;
      const outputKind=recipe?.output||{lumber:'wood',hunting:'meat',quarry:'stone',oxTether:'stone'}[type];
      const depot=buildings.filter(other=>other.userData.ownerId===b.userData.ownerId&&buildingStorageCapacity(other,outputKind)>0).sort((a,c)=>dist2D(a.position,b.position)-dist2D(c.position,b.position))[0];
      const distance=depot?Math.round(dist2D(depot.position,b.position)/TILE_SIZE):null;
      const work=recipe?.duration??(type==='quarry'?QUARRY_MINING_TIME:35);
      const efficiency=depot?Math.round(100*work/(work+2*dist2D(depot.position,b.position)/(workers[0]?.userData.speed||3.2))):0;
      detailBody.textContent=`Workers: ${workers.length}/${BUILDINGS[type].workers}\n${recipe ? `Recipe: ${Object.keys(recipe.input||{}).join('+')||'land'} → ${recipe.amount} ${recipe.output}\nOutput buffer: ${b.userData.outputBuffer||0}\nProgress: ${Math.round((b.userData.progress||0)*100)}%\n` : ''}${type==='quarry' ? `Stone buffer: ${b.userData.stoneBuffer}/24\nOxen: ${buildings.filter(other=>other.userData.type==='oxTether'&&other.userData.ownerId===b.userData.ownerId).length}\n` : ''}Delivery: ${depot?.userData.type||'none'} · ${distance??'—'} tiles\nEstimated efficiency: ${efficiency}%\n${workers.map((worker,index)=>`Worker ${index+1}: ${worker.userData.state}`).join('\n')}`;
    }
    detailBody.textContent=`Health: ${Math.ceil(b.userData.hp)}/${type==='house'?400:180}\n${detailBody.textContent}`;
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
  allMilitarySelected=false;
  selectedObject = obj;
  updateSelectionArrows();
  detailActions.replaceChildren();
  if (obj.userData.type === 'barracks') {
    detailActions.textContent = '1 Spearman · 2 Archer · 3 Maceman · 4 Crossbowman · 5 Pikeman · 6 Swordsman\nEach needs 1 idle peasant, gold and armoury equipment.';
  }
  if(obj.userData.type==='mercenaryPost') {
    detailActions.textContent='1 Slave · 2 Slinger · 3 Assassin · 4 Arabian Archer · 5 Horse Archer · 6 Arabian Swordsman · 7 Fire Thrower';
  }
  if (obj.userData.type && obj.userData.type !== 'house') {
    const refund=Object.entries(costs[obj.userData.type]).map(([kind,amount]) => `${Math.floor(amount/2)} ${kind}`).filter(label => !label.startsWith('0 '));
    detailActions.textContent += `${detailActions.textContent ? '\n' : ''}X: dismantle${refund.length ? ` · +${refund.join(', ')}` : ''}`;
  }
  if(RECIPE_OPTIONS[obj.userData.type])detailActions.textContent+=`\nC: change recipe (${RECIPE_OPTIONS[obj.userData.type].map(recipe=>recipe.output).join(' / ')})`;
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

let qHoldTimer=null,qHeld=false;
const commandGroups=()=>allMilitarySelected?buildings.filter(b=>b.userData.ownerId===localOwner()&&['barracks','mercenaryPost'].includes(b.userData.type)):[selectionBuilding()].filter(Boolean);
function issueQuickOrder() {
  const groups=commandGroups().filter(b=>['barracks','mercenaryPost'].includes(b.userData.type)&&b.userData.ownerId===localOwner());
  if(!groups.length)return toast('Select your military building or troop first');
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);ray.far=95;
  const aimedPeer=activePeers().find(peer=>peer.remote&&ray.intersectObject(peer.remote,true).length);
  if(aimedPeer){for(const barracks of groups)setRallyPoint(barracks,aimedPeer.remote.position,true,true);return;}
  const aimedEnemy=npcs.find(n=>n.userData.ownerId!==localOwner()&&n.userData.alive&&ray.intersectObject(n,true).length);
  if(aimedEnemy){for(const barracks of groups){setRallyPoint(barracks,aimedEnemy.position);barracks.userData.order='attackMove';}return;}
  const point=getAimGroundPoint();if(!point)return toast('Look at ground to give an order');
  for(const barracks of groups){setRallyPoint(barracks,point);barracks.userData.order='move';}
}
function closeCommandMenu() {commandMenu.hidden=true;uiMode='game';controls.lock();}
function issueCommand(command) {
  const groups=commandGroups().filter(b=>['barracks','mercenaryPost'].includes(b.userData.type)&&b.userData.ownerId===localOwner());
  if(!groups.length){closeCommandMenu();return;}
  if(command==='attack')issueQuickOrder();
  else if(['move','attackMove','guard'].includes(command)) {const point=getAimGroundPoint();if(point)for(const barracks of groups)setRallyPoint(barracks,point);}
  else if(command==='retreat'){const house=buildings.find(b=>b.userData.type==='house'&&b.userData.ownerId===localOwner());if(house)for(const barracks of groups)setRallyPoint(barracks,house.position);}
  for(const barracks of groups){barracks.userData.order=command;for(const unit of barracks.userData.units)if(isMilitary(unit.userData.kind))unit.userData.order=command;sendPeerAction({kind:'order',x:barracks.position.x,z:barracks.position.z,command});}
  toast(`Troops: ${command}`);closeCommandMenu();
}
commandMenu.addEventListener('click',event=>{const button=event.target.closest('[data-command]');if(button)issueCommand(button.dataset.command);});

document.addEventListener('keydown', e => {
  keys[e.code]=true;
  if (e.code==='Space' && canPlay()) {
    e.preventDefault();
    if (!e.repeat) jumpRequested=true;
  }
  if (e.code==='Tab' && (canPlay()||uiMode==='inventory')) {
    e.preventDefault();
    if (!e.repeat) {
      if(uiMode==='inventory'){inventoryEl.hidden=true;uiMode='game';controls.lock();}
      else {inventoryEl.hidden=false;uiMode='inventory';controls.unlock();updateHUD();}
    }
    return;
  }
  if (e.code==='Escape') {
    if(uiMode==='buildMenu'){closeBuildMenu();return;}
    if(uiMode==='command'){closeCommandMenu();return;}
    if(uiMode==='inventory'){inventoryEl.hidden=true;uiMode='game';controls.lock();return;}
    if (fallbackLook) {
      fallbackLook=false;
      uiMode='main';
      resumeBtn.hidden=!gameStarted||matchEnded;
      startEl.style.display='flex';
    }
    return;
  }
  if (e.code==='KeyE' && !e.repeat) {
    if (uiMode === 'buildMenu') closeBuildMenu();
    else if (canPlay()) openBuildMenu();
    return;
  }
  if (uiMode==='buildMenu' && !e.repeat) {
    const index={Digit1:0,Digit2:1,Digit3:2,Digit4:3,Digit5:4,Digit6:5}[e.code];
    if (index !== undefined) {
      selectBuilding(buildingChoices[index]);
      closeBuildMenu();
      return;
    }
  }
  if (!canPlay()) return;
  if(e.code==='KeyG'&&!e.repeat){const first=buildings.find(b=>b.userData.ownerId===localOwner()&&['barracks','mercenaryPost'].includes(b.userData.type));if(!first)return toast('No military buildings yet');selectObject(first);allMilitarySelected=true;updateSelectionArrows();toast('All military selected');return;}
  if (e.code==='KeyX' && !e.repeat) { demolishSelectedBuilding(); return; }
  const barracks = selectionBuilding();
  if(e.code==='KeyC'&&!e.repeat&&barracks&&RECIPE_OPTIONS[barracks.userData.type]) {
    if(barracks.userData.outputBuffer>0||barracks.userData.units.some(unit=>unit.userData.carrying>0))return toast('Finish delivering the current batch first');
    const options=RECIPE_OPTIONS[barracks.userData.type],current=options.findIndex(option=>option.output===barracks.userData.recipe.output),index=(current+1)%options.length;
    barracks.userData.recipe={...RECIPES[barracks.userData.type],...options[index]};
    sendPeerAction({kind:'recipe',x:barracks.position.x,z:barracks.position.z,index});toast(`Now making ${options[index].output}`);return;
  }
  if (barracks && !e.repeat) {
    const roster=barracks.userData.type==='barracks' ? ['spearman','archer','maceman','crossbowman','pikeman','swordsman'] : barracks.userData.type==='mercenaryPost' ? ['slave','slinger','assassin','arabianArcher','horseArcher','arabianSwordsman','fireThrower'] : [];
    const index=Number(e.code.slice(-1))-1;
    if(e.code.startsWith('Digit')&&roster[index]) {recruitSoldier(roster[index],barracks);return;}
    if(barracks.userData.type==='barracks'&&e.code==='KeyR')recruitSoldier('swordsman',barracks);
    if(barracks.userData.type==='barracks'&&e.code==='KeyT')recruitSoldier('archer',barracks);
  }
  if(e.code==='KeyQ'&&!e.repeat) {
    qHeld=false;clearTimeout(qHoldTimer);
    qHoldTimer=setTimeout(()=>{if(keys.KeyQ&&canPlay()){qHeld=true;uiMode='command';commandMenu.hidden=false;controls.unlock();}},280);
  }
});
document.addEventListener('keyup', e => {
  if(e.code==='KeyQ'){clearTimeout(qHoldTimer);if(!qHeld&&canPlay())issueQuickOrder();qHeld=false;}
  keys[e.code]=false;
});
addEventListener('blur', () => {
  for (const code of Object.keys(keys)) keys[code]=false;
  jumpRequested=false;
});

document.addEventListener('mousedown', e => {
  if (!canPlay()) return;
  if (e.button===0) {
    if (selectedBuild) placeBuilding();
    else {
      if (!swordAttack()) {
        const target = aimedSelectable();
        if (target) selectObject(target);
        else clearSelection();
      }
    }
  }
  if (e.button===2) cancelBuild();
});
document.addEventListener('contextmenu', e => e.preventDefault());

function updateHUD() {
  healthFill.style.width=`${playerHealth}%`;
  healthValue.textContent=`${Math.ceil(playerHealth)} / 100`;
  staminaFill.style.width=`${playerStamina}%`;
  staminaValue.textContent=`${Math.ceil(playerStamina)} / 100`;
  const soldiers=npcs.filter(n=>n.userData.ownerId===localOwner()&&isMilitary(n.userData.kind)).length;
  const workers=npcs.filter(n=>n.userData.ownerId===localOwner()&&n.userData.kind!=='peasant'&&!isMilitary(n.userData.kind)&&n.userData.kind!=='mule').length;
  const zoneStatus=sandboxMode ? '<b>Sandbox</b> · No shrinking zone' : `<b>${MATCH_PHASES[zone.phase].name}</b> · ${Math.floor(zone.elapsed/60)}:${String(Math.floor(zone.elapsed%60)).padStart(2,'0')} · Safe ${Math.round(zone.radius)}m`;
  const statsHtml = `
    ${multiplayer.roomCode ? `<b>Online:</b> ${multiplayer.roomCode} · ${activePeers().some(peer=>peer.reliable?.readyState==='open')?'WebRTC':'Relay'} · ${multiplayer.status}<br>` : ''}
    ${zoneStatus}<br>
    Wood ${Math.floor(resources.wood)} · Food ${Math.floor(resources.food)} · Gold ${Math.floor(settlement.gold)}<br>
    People ${settlement.population}/${settlement.housingCapacity} · Idle ${settlement.idlePeasants} · ★ ${settlement.popularity}<br>
    <span style="color:#bbb">${basePlaced ? selectedBuild ? `Placing ${BUILDINGS[selectedBuild]?.name}` : 'E Buildings · Tab Stores' : 'Place your base'}</span>
  `;
  if(statsEl.innerHTML!==statsHtml)statsEl.innerHTML=statsHtml;
  if (!inventoryEl.hidden) {
    const row = (label,value) => `<div class="inventoryRow"><span>${label}</span><strong>${value}</strong></div>`;
    const inventory=`<h3>Stores</h3>${['wood','stone','iron','wheat','flour','meat','apples','cheese','bread',...ARMOURY_ITEMS].map(kind=>row(kind,Math.floor(resources[kind]))).join('')}
      ${row('Food total',Math.floor(resources.food))}${row('Gold',Math.floor(settlement.gold))}
      <h3>People</h3>${row('Population / housing',`${settlement.population} / ${settlement.housingCapacity}`)}${row('Idle / working / soldiers',`${settlement.idlePeasants} / ${workers} / ${soldiers}`)}${row('Popularity',settlement.popularity)}
      <h3>Policy</h3><div class="settingRow">Rations: ${RATIONS[settlement.ration].name}<button data-action="ration">Change</button></div>
      <div class="settingRow">Taxes: ${TAXES[settlement.tax].name}<button data-action="tax">Change</button></div>
      ${FOOD.map(kind=>`<div class="settingRow">${kind}<button data-action="food" data-kind="${kind}">${settlement.foodEnabled[kind]?'Enabled':'Disabled'}</button></div>`).join('')}
      ${buildings.some(b=>b.userData.type==='market'&&b.userData.ownerId===localOwner()) ? `<h3>Market · click for 5, Shift for 25</h3>${Object.entries(MARKET_PRICES).map(([kind,price])=>`<div class="tradeRow">${kind} <button data-action="sell" data-kind="${kind}">Sell ${price.sell}</button><button data-action="buy" data-kind="${kind}">Buy ${price.buy}</button></div>`).join('')}` : ''}`;
    if(inventoryContents.innerHTML!==inventory)inventoryContents.innerHTML=inventory;
  }
}

inventoryContents.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const action=button.dataset.action,kind=button.dataset.kind;
  if(action==='ration')settlement.ration=(settlement.ration+1)%RATIONS.length;
  else if(action==='tax')settlement.tax=(settlement.tax+1)%TAXES.length;
  else if(action==='food')settlement.foodEnabled[kind]=!settlement.foodEnabled[kind];
  else if(action==='sell'||action==='buy') {
    const batch=event.shiftKey?25:5,price=MARKET_PRICES[kind];
    const market=buildings.find(b=>b.userData.type==='market'&&b.userData.ownerId===localOwner()&&dist2D(b.position,camera.position)<35);
    if(!market)return toast('Visit your market to trade');
    if(action==='sell') {if(resources[kind]<batch)return toast(`Need ${batch} ${kind}`);removeResource(kind,batch);settlement.gold+=batch*price.sell;}
    else {if(settlement.gold<batch*price.buy)return toast('Not enough gold');if(availableStorage(kind)<batch)return toast('Storage full');settlement.gold-=batch*price.buy;addResource(kind,batch);}
    syncResources();playSound('build',.1);
  }
  updateHUD();
  sendSettlementState();
});

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
  const visible=pos=>dist2D(pos,camera.position)<60 || npcs.some(n=>n.userData.ownerId===localOwner()&&isMilitary(n.userData.kind)&&dist2D(n.position,pos)<35);

  ctx.clearRect(0,0,minimapCanvas.width,minimapCanvas.height);
  ctx.beginPath();
  ctx.arc(center,center,radius,0,Math.PI*2);
  ctx.fillStyle = '#587848';
  ctx.fill();
  ctx.save();
  ctx.clip();

  if(!basePlaced && !sandboxMode && multiplayer.sectorCount>=2) {
    const start=multiplayer.sectorAngle-Math.PI/multiplayer.sectorCount;
    const end=multiplayer.sectorAngle+Math.PI/multiplayer.sectorCount;
    ctx.fillStyle='rgba(14,24,20,.35)';
    ctx.beginPath();ctx.moveTo(center,center);ctx.arc(center,center,radius,end,start+Math.PI*2);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(159,231,133,.28)';
    ctx.beginPath();ctx.moveTo(center,center);ctx.arc(center,center,radius,start,end);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#f6df83';ctx.lineWidth=2;
    for(const angle of [start,end]) {ctx.beginPath();ctx.moveTo(center,center);ctx.lineTo(center+Math.cos(angle)*radius,center+Math.sin(angle)*radius);ctx.stroke();}
  }

  for (const deposit of stoneDeposits) dot(deposit.position,6,'#757d77');
  for (const deposit of ironDeposits) dot(deposit.position,5,'#39485b');
  for (const oasis of oases) dot(oasis.position,Math.max(3,oasis.radius*scale),'#6cae66');
  for(const camp of pveCamps)if(!camp.cleared&&visible(camp.position))dot(camp.position,5,'#b83d32');
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
    if(building.userData.ownerId!==localOwner()&&!visible(building.position))continue;
    ctx.fillStyle = building.userData.ownerId===localOwner() ? buildingColors[building.userData.type]||'#c4aa7d' : '#d56b65';
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
  for (const unit of npcs) if (!unit.userData.insideHome && (unit.userData.ownerId===localOwner()||visible(unit.position))) dot(unit.position,2.6,unit.userData.ownerId===localOwner() ? '#67dcff' : '#ff7777');

  if (selectedObject) {
    const [x,y] = point(selectedObject.position);
    ctx.strokeStyle = '#ffdd58';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x,y,7,0,Math.PI*2);
    ctx.stroke();
  }

  for (const peer of activePeers()) if (peer.remote&&visible(peer.remote.position)) dot(peer.remote.position,3.2,'#f4d87a');

  if(!sandboxMode)for(const [ringRadius,color] of [[zone.radius,'#f8bd58'],[zone.nextRadius,'#f1e7a2']]) {
    const [zx,zy]=point(zone.center);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(zx,zy,ringRadius*scale,0,Math.PI*2);ctx.stroke();
  }

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

drawMinimap();

let minimapElapsed = 0;
let hudElapsed=0;
let simulationAccumulator=0;
function animate() {
  requestAnimationFrame(animate);
  const frameStart=benchmark ? performance.now() : 0;
  const dt=Math.min(clock.getDelta(),.05);
  updatePlayer(dt);
  swordSwingTime=Math.max(0,swordSwingTime-dt);
  royalHand.rotation.x=swordSwingTime>0 ? -Math.sin((.38-swordSwingTime)/.38*Math.PI)*1.1 : 0;
  if (multiplayer.peers.size && performance.now()-multiplayer.lastPositionSent>=50) {
    multiplayer.lastPositionSent=performance.now();
    const direction=new THREE.Vector3();
    camera.getWorldDirection(direction);
    sendGamePacket({type:'position',name:multiplayer.name,x:camera.position.x,z:camera.position.z,yaw:Math.atan2(direction.x,direction.z),health:playerHealth});
  }
  if (multiplayer.peers.size && performance.now()-multiplayer.lastUnitsSent>=100) {
    multiplayer.lastUnitsSent=performance.now();
    sendGamePacket({type:'units',units:npcs.filter(n=>n.userData.ownerId===multiplayer.playerId||(multiplayer.isHost&&n.userData.ownerId==='pve')).slice(0,100).map(n=>({id:n.userData.id,x:n.position.x,z:n.position.z,yaw:n.rotation.y,state:n.userData.state,attacking:n.userData.attacking,targetId:['lumberjack','hunter'].includes(n.userData.kind)?n.userData.target?.userData.id:null}))});
  }
  if(multiplayer.peers.size&&multiplayer.isHost&&performance.now()-(multiplayer.lastWildlifeSent||0)>=500) {
    multiplayer.lastWildlifeSent=performance.now();
    sendGamePacket({type:'wildlife',deer:deer.slice(0,100).map(animal=>({id:animal.userData.id,x:animal.position.x,z:animal.position.z,hp:animal.userData.hp}))});
  }
  updateGhost();
  simulationAccumulator+=dt;
  while(simulationAccumulator>=.05) {updateNPCs(.05);updateWildlife(.05);updateEconomy(.05);updateZone(.05);updatePvE(.05);simulationAccumulator-=.05;}
  updateNPCVisuals(dt);
  for (const peer of activePeers()) if (peer.remote) peer.remote.userData.healthBar.quaternion.copy(peer.remote.quaternion).invert().multiply(camera.quaternion);
  deerSpawnTimer+=dt;
  if (deerSpawnTimer>=28 && uiMode!=='main' && (!multiplayer.peers.size||multiplayer.isHost)) {
    deerSpawnTimer=0;
    if (deer.length<60) spawnHerd(true);
  }
  hudElapsed+=dt;
  if(hudElapsed>=.1) {hudElapsed=0;updateDetails();updateHUD();}
  updateStorageVisuals();
  minimapElapsed += dt;
  if (minimapElapsed >= .1) {
    minimapElapsed = 0;
    drawMinimap();
  }
  renderer.autoClear=true;
  renderer.render(scene,camera);
  if(benchmark)benchmark.mainDrawCalls=renderer.info.render.calls;
  if (uiMode==='game' && basePlaced) {
    renderer.autoClear=false;
    renderer.clearDepth();
    renderer.render(viewScene,viewCamera);
    renderer.autoClear=true;
  }
  if(benchmark) {
    if(benchmark.basePlaced!==basePlaced) {benchmark.frames=0;benchmark.cpuMs=0;benchmark.basePlaced=basePlaced;}
    benchmark.frames++;
    benchmark.cpuMs+=performance.now()-frameStart;
    benchmark.averageCpuMs=benchmark.cpuMs/benchmark.frames;
    if(benchmark.frames%30===0)document.body.dataset.benchmark=JSON.stringify(benchmark);
  }
}
animate();

const pendingGame=sessionStorage.getItem('rts-new-game');
if (pendingGame) {
  sessionStorage.removeItem('rts-new-game');
  try {
    const next=JSON.parse(pendingGame);
    playerNameInput.value=next.name;
    if (next.mode==='solo') beginSolo();
    else if (['quick','create','join'].includes(next.mode)) beginMatch(next.mode,next.roomCode);
  } catch { /* A stale restart request can be ignored. */ }
}

addEventListener('resize', () => {
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  viewCamera.aspect=innerWidth/innerHeight;
  viewCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
