import test from 'node:test';
import assert from 'node:assert/strict';
import { solidDefault, solidFaces, solidGeometry, extendFace } from '../src/solids.ts';
import { newProject,newNode,validateProject } from '../src/model.ts';
import { exportArchive,importArchive } from '../src/archive.ts';
test('all four primitives have a surface; planar cuts close the cube and bevels add faces',()=>{
  for(const name of ['cube','sphere','cone','cylinder'])assert.ok(solidFaces(solidDefault(name)).length>=6);
  const cube=solidDefault('cube');assert.equal(solidFaces(cube).length,6);
  const cut={...cube,cuts:[{normal:[1,0,0],offset:.2}]};
  const faces=solidFaces(cut);
  assert.equal(faces.length,6);assert.ok(faces.flat().every(v=>v.x<=.20001));
  assert.ok(faces.some(f=>f.every(v=>Math.abs(v.x-.2)<.00001)));
  assert.ok(solidFaces({...cut,radius:.2}).length>faces.length);
  const extruded=extendFace(cube,0,1);
  assert.ok(solidFaces(extruded).flat().some(v=>Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z))>1.9));
});
test('mesh faces, triangulation and stable IDs survive portable export',async()=>{
  const p=newProject();const solid={...solidDefault('cube'),mesh:{vertices:[[0,0,0],[1,0,0],[0,1,0],[.5,.4,0]],faces:[[0,1,3,2]],triangles:[[0,1,3],[0,3,2]]}};
  p.nodes.push(newNode('solid',[2,4,3],{solid}));const geometry=solidGeometry(solid);
  assert.equal(geometry.getAttribute('position').count,6);geometry.dispose();
  const output=await importArchive(new File([await exportArchive(p)],'mesh.mgmap.zip'));
  assert.deepEqual(output.project.nodes,p.nodes);
  solid.mesh.faces[0][0]=99;assert.throws(()=>validateProject(p));
});