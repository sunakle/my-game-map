import type { Solid, Point } from './solids';
declare global { interface Window { mapWindow?: {
  saveArchive(filename:string, bytes:Uint8Array):Promise<boolean>;
  beforeClose(f:()=>Promise<boolean>):()=>void;
  editMesh(data:{name:string;vertices:Point[];faces:number[][]}):Promise<Solid['mesh']|null>;
} } }
