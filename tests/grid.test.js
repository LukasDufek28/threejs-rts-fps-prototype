import assert from 'node:assert/strict';
import test from 'node:test';
import {LogicalGrid} from '../world/Grid.js';
import {BUILDINGS,MAP_CELLS,TILE_SIZE,WORLD_RADIUS} from '../config/balance.js';

test('logical map remains separate from rendered geometry and routes around buildings',()=>{
  const grid=new LogicalGrid();
  assert.equal(grid.blocked.length,MAP_CELLS*MAP_CELLS);
  assert.equal(WORLD_RADIUS,MAP_CELLS*TILE_SIZE/2);
  const cells=grid.footprint(0,0,3,3);
  assert.equal(cells.length,9);
  grid.occupy(cells,1);
  assert.equal(grid.free(cells),false);
  const route=grid.findPath({x:-10,z:0},{x:10,z:0});
  assert.ok(route.length>10);
  assert.ok(route.every(point=>{const tile=grid.tile(point.x,point.z);return !grid.blocked[grid.index(tile.x,tile.z)];}));
  grid.occupy(cells,0);
  assert.equal(grid.free(cells),true);
});

test('building configuration exposes worker counts and logistics positions',()=>{
  assert.equal(BUILDINGS.quarry.workers,3);
  assert.equal(BUILDINGS.oxTether.workers,1);
  assert.equal(BUILDINGS.quarry.deposit,'stone');
  assert.ok(BUILDINGS.bakery.entrance);
  assert.ok(BUILDINGS.wheatFarm.mask.length>0);
});
