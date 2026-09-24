import assert from 'node:assert/strict';
import test from 'node:test';
import {zoneAt} from '../simulation/ZoneMath.js';

test('the opening stays safe for five minutes and later phases increase pressure',()=>{
  assert.equal(zoneAt(0).radius,400);
  assert.equal(zoneAt(299).radius,400);
  assert.equal(zoneAt(300).radius,400);
  assert.ok(zoneAt(450).radius<400);
  assert.equal(zoneAt(600).radius,340);
  assert.ok(zoneAt(1680).damage>zoneAt(600).damage);
  assert.equal(zoneAt(1800).radius,15);
});
