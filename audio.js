const sounds = {
  step:['step1.ogg','step2.ogg'],
  jump:['jump.wav'],
  chop:['chop.ogg'],
  mine:['mine.wav'],
  train:['train.ogg'],
  bow:['arrow-grab.wav','arrow-whoosh.wav'],
  sword:['sword.ogg'],
  hit:['hit.wav'],
  death:['death.ogg'],
  build:['build.ogg'],
  gather:['gather.ogg'],
  victory:['victory.ogg']
};

let context;
const buffers=new Map();
const variants=new Map();

async function load(file) {
  if (!buffers.has(file)) {
    const url=new URL(`./assets/audio/${file}`,import.meta.url);
    buffers.set(file,fetch(url).then(response => {
      if (!response.ok) throw new Error(`Audio unavailable: ${file}`);
      return response.arrayBuffer();
    }).then(data => context.decodeAudioData(data)));
  }
  return buffers.get(file);
}

export function playSound(kind, volume=.15) {
  const files=sounds[kind];
  if (!files || volume<=0) return;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    context.resume();
    const index=variants.get(kind)||0;
    variants.set(kind,index+1);
    const chosen=kind==='bow' ? files : [files[index%files.length]];
    chosen.forEach((file,layer) => load(file).then(buffer => {
      if (context.state!=='running') return;
      const source=context.createBufferSource();
      const gain=context.createGain();
      source.buffer=buffer;
      source.playbackRate.value=kind==='bow' && layer===0 ? 1.35 : 1;
      gain.gain.value=Math.min(.5,volume*(kind==='bow' && layer===0 ? .65 : 1));
      source.connect(gain).connect(context.destination);
      source.start(context.currentTime+(kind==='bow' && layer===1 ? .045 : 0));
    }).catch(() => {}));
  } catch { /* Audio may be unavailable until the browser permits playback. */ }
}
