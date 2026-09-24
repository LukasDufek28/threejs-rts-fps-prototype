import assert from 'node:assert/strict';
import test from 'node:test';
import {nearestUnclaimedTarget, targetClaimedByAnother} from '../world/WorkerTargets.js';

const target = (x, z=0) => ({position:{x,z},userData:{alive:true}});
const worker = (x, id, kind='lumberjack') => ({position:{x,z:0},userData:{id,kind,alive:true,target:null}});

test('workers choose the nearest live unclaimed target without a range limit', () => {
  const near=target(70), far=target(250), dead=target(5);
  dead.userData.alive=false;
  const first=worker(0,'a'), second=worker(0,'b');
  first.userData.target=near;
  assert.equal(targetClaimedByAnother(near,second,[first,second]),true);
  assert.equal(nearestUnclaimedTarget([dead,near,far],second,[first,second]),far);
  first.userData.target=null;
  assert.equal(nearestUnclaimedTarget([dead,near,far],second,[first,second]),near);
});

test('the lower worker ID keeps a target if two peers claim it at once', () => {
  const tree=target(80), first=worker(0,'a'), second=worker(1,'b');
  first.userData.target=tree;
  second.userData.target=tree;
  assert.equal(targetClaimedByAnother(tree,first,[first,second]),false);
  assert.equal(targetClaimedByAnother(tree,second,[first,second]),true);
});
