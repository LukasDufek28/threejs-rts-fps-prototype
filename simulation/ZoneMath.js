import {MATCH_PHASES} from '../config/balance.js';

export function zoneAt(seconds,phases=MATCH_PHASES) {
  let phase=0;
  for(let i=1;i<phases.length;i++)if(seconds>=phases[i].start)phase=i;
  const current=phases[phase],next=phases[phase+1];
  const fraction=next?Math.max(0,Math.min(1,(seconds-current.start)/(next.start-current.start))):1;
  return {phase,radius:next?current.radius+(next.radius-current.radius)*fraction:current.radius,nextRadius:next?.radius||current.radius,damage:current.damage};
}
