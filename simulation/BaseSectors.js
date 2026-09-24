import {TILE_SIZE, WORLD_RADIUS} from '../config/balance.js';

export function pointInSector(x, z, centerAngle, sectorCount) {
  if (![x,z,centerAngle,sectorCount].every(Number.isFinite) || sectorCount<2) return false;
  const angle=Math.atan2(z,x);
  const difference=Math.atan2(Math.sin(angle-centerAngle),Math.cos(angle-centerAngle));
  return Math.abs(difference)<=Math.PI/sectorCount+1e-9;
}

export function footprintInSector(x, z, width, height, centerAngle, sectorCount) {
  if (![width,height].every(Number.isFinite) || width<=0 || height<=0) return false;
  const halfWidth=width*TILE_SIZE/2, halfHeight=height*TILE_SIZE/2;
  return [x-halfWidth,x+halfWidth].every(px =>
    [z-halfHeight,z+halfHeight].every(pz => pointInSector(px,pz,centerAngle,sectorCount)));
}

export function startingBaseInSector(x, z, storage, centerAngle, sectorCount) {
  return !!storage && [
    {x,z},storage.stockpile,storage.granary
  ].every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z) && Math.hypot(point.x,point.z)<=WORLD_RADIUS-4) &&
    footprintInSector(x,z,3,3,centerAngle,sectorCount) &&
    footprintInSector(storage.stockpile?.x,storage.stockpile?.z,2,2,centerAngle,sectorCount) &&
    footprintInSector(storage.granary?.x,storage.granary?.z,2,2,centerAngle,sectorCount);
}
