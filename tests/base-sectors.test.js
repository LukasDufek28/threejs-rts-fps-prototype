import assert from 'node:assert/strict';
import test from 'node:test';
import {footprintInSector, startingBaseInSector} from '../simulation/BaseSectors.js';

test('two players have opposite map halves and the whole base must fit', () => {
  const stores={stockpile:{x:28,z:8},granary:{x:28,z:-8}};
  assert.equal(startingBaseInSector(30,0,stores,0,2),true);
  assert.equal(startingBaseInSector(30,0,stores,Math.PI,2),false);
  assert.equal(footprintInSector(1,0,3,3,0,2),false);
  assert.equal(startingBaseInSector(30,0,{...stores,granary:{x:-4,z:0}},0,2),false);
});

test('three players receive equal angular thirds', () => {
  for(let slot=0;slot<3;slot++) {
    const angle=slot*2*Math.PI/3;
    const x=Math.cos(angle)*100,z=Math.sin(angle)*100;
    assert.equal(footprintInSector(x,z,3,3,angle,3),true);
    for(let other=0;other<3;other++)if(other!==slot)
      assert.equal(footprintInSector(x,z,3,3,other*2*Math.PI/3,3),false);
  }
});
