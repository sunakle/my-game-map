import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

export type Point = [number, number, number];
export type Primitive = 'cube' | 'cylinder' | 'cone' | 'sphere';
export type Cut = { normal: Point; offset: number };
export interface Solid {
  primitive: Primitive;
  radius: number;
  segments: number;
  cuts: Cut[];
  hull?: Point[];
  mesh?: { vertices:Point[]; faces:number[][]; triangles:Point[] };
}
export const solidNames = { cube: 'Куб', sphere: 'Сфера', cylinder: 'Цилиндр', cone: 'Конус' };
export const solidDefault = (primitive: Primitive): Solid => ({ primitive, radius: 0, segments: 3, cuts: [] });
type Face = Vector3[];
const eps = 1e-6;
const key = (p: Vector3) => [p.x,p.y,p.z].map(x => Math.round(x / eps)).join('/');
const normal = (f: Face) => f[1].clone().sub(f[0]).cross(f[2].clone().sub(f[0])).normalize();
function ordered(points: Face, n: Vector3): Face {
  const unique = [...new Map(points.map(p => [key(p),p])).values()];
  if (unique.length < 3) return [];
  const c = unique.reduce((sum,p) => sum.add(p),new Vector3()).divideScalar(unique.length);
  const u = unique[0].clone().sub(c).normalize(), v = n.clone().cross(u);
  const angle = (p: Vector3) => Math.atan2(p.clone().sub(c).dot(v),p.clone().sub(c).dot(u));
  return unique.sort((a,b) => angle(a)-angle(b)).filter((p,i,arr) => {
    const prev=arr[(i+arr.length-1)%arr.length], next=arr[(i+1)%arr.length];
    return p.clone().sub(prev).cross(next.clone().sub(p)).lengthSq()>1e-16;
  });
}

function hullFaces(points: Vector3[]): Face[] {
  const geo = new ConvexGeometry(points), attr = geo.getAttribute('position');
  const planes = new Map<string,{points:Face,n:Vector3}>();
  for(let i=0;i<attr.count;i+=3){
    const tri=[0,1,2].map(j=>new Vector3().fromBufferAttribute(attr,i+j)), n=normal(tri);
    const id=key(n)+'/'+Math.round(n.dot(tri[0])/eps);
    if(!planes.has(id)) planes.set(id,{points:[],n});
    planes.get(id)!.points.push(...tri);
  }
  geo.dispose();
  return [...planes.values()].map(p=>ordered(p.points,p.n)).filter(f=>f.length>=3);
}

function baseFaces(s: Solid): Face[] {
  if (s.hull) return hullFaces(s.hull.map(p=>new Vector3(...p)));
  const pts:Vector3[]=[];
  if(s.primitive==='cube') {
    for(const x of [-1,1]) for(const y of [-1,1]) for(const z of [-1,1]) pts.push(new Vector3(x,y,z));
  } else {
    const sphere=s.primitive==='sphere', rings=sphere?12:1, steps=24;
    for(let j=0;j<=rings;j++){
      const a=Math.PI*j/rings;
      const y=sphere?-Math.cos(a):j*2-1;
      const r=sphere?Math.sin(a):s.primitive==='cone'?1-j:1;
      for(let i=0;i<(r<eps?1:steps);i++){
        const b=2*Math.PI*i/steps;
        pts.push(new Vector3(r*Math.cos(b),y,r*Math.sin(b)));
      }
    }
  }
  return hullFaces(pts);
}

// Keep n·p <= offset, then close the exposed boundary with an outward polygon.
function clip(faces:Face[], n:Vector3, offset:number):Face[] {
  const result:Face[]=[], cap:Face=[];
  let outside=false;
  for(const face of faces){
    const ring:Face=[];
    for(let i=0;i<face.length;i++){
      const a=face[i], b=face[(i+1)%face.length], da=n.dot(a)-offset, db=n.dot(b)-offset;
      if(da<=eps) ring.push(a); else outside=true;
      if((da < -eps && db > eps)||(da > eps && db < -eps)){
        const p=a.clone().lerp(b,da/(da-db)); ring.push(p); cap.push(p);
      }
      if(Math.abs(da)<=eps)cap.push(a);
    }
    if(ring.length>=3) { const f=ordered(ring,normal(face)); if(f.length>=3)result.push(f); }
  }
  if(!outside)return faces;
  const last=ordered(cap,n);
  if(last.length>=3)result.push(last);
  return result;
}

export function solidFaces(s:Solid):Face[] {
  if(s.mesh){const verts=s.mesh.vertices.map(v=>new Vector3(...v));return s.mesh.faces.map(f=>f.map(i=>verts[i]));}
  let faces=baseFaces(s);
  for(const cut of s.cuts)faces=clip(faces,new Vector3(...cut.normal).normalize(),cut.offset);
  if(s.radius<=eps || !faces.length)return faces;
  const edges=new Map<string,{p:Vector3; normals:Vector3[]}>();
  for(const f of faces){
    const n=normal(f);
    for(let i=0;i<f.length;i++){
      const p=f[i], q=f[(i+1)%f.length], id=[key(p),key(q)].sort().join(':');
      if(!edges.has(id))edges.set(id,{p,normals:[]});
      edges.get(id)!.normals.push(n);
    }
  }
  for(const edge of edges.values()){
    if(edge.normals.length!==2)continue;
    const [a,b]=edge.normals, angle=a.angleTo(b);
    if(angle<Math.PI/5 || angle>Math.PI-.001)continue;
    for(let j=1;j<=s.segments;j++){
      const t=j/(s.segments+1), n=a.clone().multiplyScalar(Math.sin((1-t)*angle)).addScaledVector(b,Math.sin(t*angle)).normalize();
      const inset=s.radius*(Math.cos((t-.5)*angle)/Math.cos(angle/2)-1);
      faces=clip(faces,n,n.dot(edge.p)-inset);
    }
  }
  return faces;
}

export function solidGeometry(s:Solid, selectedFace=-1) {
  if(s.mesh){
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(s.mesh.triangles.flatMap(tri=>tri.flatMap(i=>s.mesh!.vertices[i])),3));
    geometry.computeVertexNormals();geometry.addGroup(0,s.mesh.triangles.length*3,0);return geometry;
  }
  const faces=solidFaces(s), positions:number[]=[], map:number[]=[];
  const geometry=new BufferGeometry();
  let groupStart=0,groupMaterial=0;
  faces.forEach((f,fi)=>{
    const start=positions.length/3;
    for(let i=1;i<f.length-1;i++){
      for(const p of [f[0],f[i],f[i+1]]) positions.push(...p.toArray());
      map.push(fi);
    }
    const material=fi===selectedFace?1:0;
    if(material!==groupMaterial){if(start>groupStart)geometry.addGroup(groupStart,start-groupStart,groupMaterial);groupStart=start;groupMaterial=material;}
  });
  if(positions.length/3>groupStart)geometry.addGroup(groupStart,positions.length/3-groupStart,groupMaterial);
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  geometry.userData.faces=map;
  return geometry;
}

export function extendFace(s:Solid,index:number,distance:number):Solid|null {
  const faces=solidFaces(s), face=faces[index];
  if(!face || distance<=0)return null;
  const n=normal(face);
  const points=[...new Map(faces.flat().map(p=>[key(p),p])).values(),...face.map(p=>p.clone().addScaledVector(n,distance))];
  if(points.length>2048)return null;
  return {...s, hull:points.map(p=>p.toArray() as Point),cuts:[],radius:0};
}
