export class SpatialHash {
  constructor(cellSize=16){this.cellSize=cellSize;this.cells=new Map();}
  key(x,z){return `${Math.floor(x/this.cellSize)},${Math.floor(z/this.cellSize)}`;}
  insert(object){const key=this.key(object.position.x,object.position.z);let cell=this.cells.get(key);if(!cell){cell=[];this.cells.set(key,cell);}cell.push(object);}
  nearby(position,radius){const x0=Math.floor((position.x-radius)/this.cellSize),x1=Math.floor((position.x+radius)/this.cellSize),z0=Math.floor((position.z-radius)/this.cellSize),z1=Math.floor((position.z+radius)/this.cellSize),out=[];
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const cell=this.cells.get(`${x},${z}`);if(cell)out.push(...cell);}
    return out;
  }
}
