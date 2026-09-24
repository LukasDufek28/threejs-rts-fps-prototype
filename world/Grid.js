import {MAP_CELLS,TILE_SIZE,WORLD_RADIUS} from '../config/balance.js';

export class LogicalGrid {
  constructor() { this.size=MAP_CELLS; this.blocked=new Uint8Array(MAP_CELLS*MAP_CELLS); this.fertility=new Uint8Array(MAP_CELLS*MAP_CELLS); }
  tile(x,z) { return {x:Math.floor(x/TILE_SIZE+this.size/2),z:Math.floor(z/TILE_SIZE+this.size/2)}; }
  world(x,z) { return {x:(x-this.size/2+.5)*TILE_SIZE,z:(z-this.size/2+.5)*TILE_SIZE}; }
  index(x,z) { return x>=0&&z>=0&&x<this.size&&z<this.size ? z*this.size+x : -1; }
  footprint(x,z,width,height,rotation=0,mask=null) {
    const tile=this.tile(x,z), w=rotation%2?height:width, h=rotation%2?width:height, out=[];
    for(let dz=0;dz<h;dz++) for(let dx=0;dx<w;dx++) {
      const mx=rotation%2?dz:dx,mz=rotation%2?width-1-dx:dz;
      if(!mask||mask[mz]?.[mx]==='1')out.push(this.index(tile.x+dx-Math.floor(w/2),tile.z+dz-Math.floor(h/2)));
    }
    return out;
  }
  free(cells) { return cells.every(index=>index>=0 && !this.blocked[index]); }
  occupy(cells,value) { for(const index of cells) if(index>=0) this.blocked[index]=value; }
  isFertile(x,z) { const tile=this.tile(x,z); return !!this.fertility[this.index(tile.x,tile.z)]; }
  setFertileCircle(x,z,radius) { const c=this.tile(x,z), n=Math.ceil(radius/TILE_SIZE); for(let dz=-n;dz<=n;dz++) for(let dx=-n;dx<=n;dx++) {const i=this.index(c.x+dx,c.z+dz);if(i>=0 && dx*dx+dz*dz<=n*n)this.fertility[i]=1;} }
  inside(x,z) { return Math.hypot(x,z)<WORLD_RADIUS-5; }
  findPath(from,to,maxVisited=5000) {
    const start=this.tile(from.x,from.z),end=this.tile(to.x,to.z);
    const startIndex=this.index(start.x,start.z),endIndex=this.index(end.x,end.z);
    if(startIndex<0||endIndex<0)return [];
    const heuristic=(x,z)=>Math.abs(end.x-x)+Math.abs(end.z-z);
    const best=new Map([[startIndex,0]]),previous=new Map(),heap=[];
    const push=node=>{heap.push(node);let i=heap.length-1;while(i>0){const parent=(i-1)>>1;if(heap[parent].score<=node.score)break;heap[i]=heap[parent];i=parent;}heap[i]=node;};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(true){let child=i*2+1;if(child>=heap.length)break;if(child+1<heap.length&&heap[child+1].score<heap[child].score)child++;if(heap[child].score>=last.score)break;heap[i]=heap[child];i=child;}heap[i]=last;}return top;};
    push({index:startIndex,x:start.x,z:start.z,score:heuristic(start.x,start.z),cost:0});
    let visited=0,found=false;
    while(heap.length&&visited++<maxVisited) {
      const current=pop();if(current.cost!==best.get(current.index))continue;
      if(current.index===endIndex){found=true;break;}
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x=current.x+dx,z=current.z+dz,index=this.index(x,z);
        if(index<0||(this.blocked[index]&&index!==endIndex))continue;
        const cost=current.cost+1;if(cost>=best.get(index))continue;
        best.set(index,cost);previous.set(index,current.index);push({index,x,z,cost,score:cost+heuristic(x,z)});
      }
    }
    if(!found)return [];
    const path=[];for(let index=endIndex;index!==startIndex;index=previous.get(index)){const x=index%this.size,z=Math.floor(index/this.size);path.push(this.world(x,z));if(path.length>maxVisited)return [];}
    return path.reverse();
  }
}
