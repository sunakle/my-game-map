import * as T from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MapNode, MapProject } from './model';
import { descendants } from './model';
import { extendFace, solidFaces, solidGeometry, type Solid, type Point } from './solids';
type Mode='move'|'rotate'|'scale'|'cut'|'bevel'|'extend';
type Axis='X'|'Y'|'Z';
const axes={X:new T.Vector3(1,0,0), Y:new T.Vector3(0,0,-1), Z:new T.Vector3(0,1,0)};
const titles={move:'Перемещение',rotate:'Поворот',scale:'Масштаб',cut:'Разрез',bevel:'Скругление',extend:'Вытягивание'};
export interface InteractionProps {
  project:MapProject; selected:string[]; editMode:boolean; face:number;
  onTransform(patch:Record<string,Partial<MapNode>>):void;
  onCamera(camera:MapProject['camera']):void;
}
export function modelingInput(canvas:HTMLCanvasElement, controls:OrbitControls, objects:Map<string,T.Group>, live:()=>InteractionProps, hint:(s:string)=>void){
  let mode:Mode|null=null, axis:Axis|null=null, number='', flip=false;
  let start=new T.Vector2(), pointer=new T.Vector2(), entered=false, first:T.Vector2|null=null;
  let sources: MapNode[]=[], pivot=new T.Vector3(), solidResult:Solid|null=null, valid=true;
  const changes:Record<string,Partial<MapNode>>={};
  function ray(p:T.Vector2){
    const rect=canvas.getBoundingClientRect(), rc=new T.Raycaster();
    rc.setFromCamera(new T.Vector2(2*(p.x-rect.left)/rect.width-1,1-2*(p.y-rect.top)/rect.height),controls.object as T.Camera);
    return rc.ray;
  }
  const guide=document.createElementNS('http://www.w3.org/2000/svg','svg');
  guide.classList.add('cut-guide');const line=document.createElementNS(guide.namespaceURI,'line');guide.append(line);canvas.parentElement!.append(guide);
  function drawGuide(){
    const rect=canvas.getBoundingClientRect();guide.style.display=mode==='cut'&&first?'block':'none';
    if(first){line.setAttribute('x1',String(first.x-rect.left));line.setAttribute('y1',String(first.y-rect.top));line.setAttribute('x2',String(pointer.x-rect.left));line.setAttribute('y2',String(pointer.y-rect.top));}
  }
  function updateHints(){
    drawGuide();
    if(!mode){hint('');return;}
    if(mode==='cut'){hint((first?'Укажите конец линии':'Укажите начало линии')+' · F сменить сторону · Esc отмена');return;}
    hint(titles[mode]+(axis?' · '+axis:'')+(number?' · '+number:'')+'   |   ЛКМ / Enter подтвердить · Esc отменить');
  }
  function previewSolid(node:MapNode,solid:Solid){
    const mesh=objects.get(node.id)?.getObjectByName('solid-body') as T.Mesh|undefined;
    if(!mesh)return;
    const geometry=solidGeometry(solid);
    valid=geometry.getAttribute('position').count>0;
    mesh.geometry.dispose(); mesh.geometry=geometry;
    solidResult=solid;
  }
  function end(apply:boolean){
    if(!mode)return;
    const invalid=apply&&!valid;
    const modifying=mode==='cut'||mode==='bevel'||mode==='extend';
    if(apply && valid && (!modifying || solidResult)){
      live().onTransform(modifying?{[sources[0].id]:{solid:solidResult!}}:{...changes});
    }else for(const n of sources){
      const o=objects.get(n.id);
      if(o){o.position.set(...n.position);o.rotation.set(...n.rotation);o.scale.set(...n.scale);}
      if(modifying && n.solid)previewSolid(n,n.solid);
    }
    mode=null;first=null;solidResult=null;controls.enabled=true;updateHints();
    if(invalid)hint('Разрез удалил бы фигуру целиком. Выберите другую линию.');
  }
  function begin(next:Mode){
    if(mode)end(false);
    const {project,selected,editMode}=live();
    const ids=new Set(selected.flatMap(id=>descendants(project.nodes,id)));
    sources=project.nodes.filter(n=>ids.has(n.id)&&!n.locked&&objects.get(n.id)?.visible);
    if(!sources.length)return;
    if(['cut','bevel','extend'].includes(next)&&(!editMode||sources.length!==1||!sources[0].solid))return;
    if(next==='extend' && live().face<0){hint('Щёлкните грань и нажмите E.');return;}
    mode=next;axis=null;number='';flip=false;first=null;solidResult=null;valid=true;
    const rect=canvas.getBoundingClientRect();
    if(!entered)pointer.set(rect.left+rect.width*.6,rect.top+rect.height*.5);
    start=pointer.clone();pivot.set(0,0,0);
    for(const n of sources)pivot.add(new T.Vector3(...n.position));
    pivot.divideScalar(sources.length);
    for(const key of Object.keys(changes))delete changes[key];
    controls.enabled=false;updateHints();
  }
  function update(){
    if(!mode||mode==='cut')return;
    const cam=controls.object, view=cam.getWorldDirection(new T.Vector3()), screen=new T.Plane().setFromNormalAndCoplanarPoint(view,pivot);
    const a=ray(start).intersectPlane(screen,new T.Vector3()), b=ray(pointer).intersectPlane(screen,new T.Vector3());
    if(!a||!b)return;
    const delta=b.sub(a), dx=pointer.x-start.x,dy=pointer.y-start.y;
    const typed=number && Number.isFinite(Number(number))?Number(number):undefined;
    if(mode==='bevel'||mode==='extend'){
      const node=sources[0], solid=node.solid!;
      if(mode==='bevel')previewSolid(node,{...solid,radius:T.MathUtils.clamp(typed??(solid.radius+dx*.005),0,.75)});
      else {const result=extendFace(solid,live().face,Math.max(.001,typed??(.2+dx*.012)));if(result)previewSolid(node,result);}
      return;
    }
    const direction=axis?axes[axis]:view;
    const rotation=new T.Quaternion().setFromAxisAngle(direction,typed!==undefined?typed*Math.PI/180:dx*.012);
    const factor=Math.max(.01,typed??Math.exp((dx-dy)*.007));
    const scale=new T.Vector3(...(['X','Z','Y'] as Axis[]).map(k=>axis===null||axis===k?factor:1) as Point);
    const shift=axis?direction.clone().multiplyScalar(typed??(Math.abs(direction.dot(view))>.95?-dy*.03:delta.dot(direction))):delta;
    if(!axis && typed!==undefined && shift.lengthSq())shift.normalize().multiplyScalar(typed);
    for(const n of sources){
      const o=objects.get(n.id); if(!o)continue;
      const pos=new T.Vector3(...n.position), q=new T.Quaternion().setFromEuler(new T.Euler(...n.rotation));
      if(mode==='move'){o.position.copy(pos.add(shift));changes[n.id]={position:o.position.toArray()};}
      if(mode==='rotate'){
        o.position.copy(pos.sub(pivot).applyQuaternion(rotation).add(pivot));o.quaternion.copy(q.premultiply(rotation));
        changes[n.id]={position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z]};
      }
      if(mode==='scale'){
        o.position.copy(pos.sub(pivot).multiply(scale).add(pivot));o.scale.set(...n.scale).multiply(scale);
        changes[n.id]={position:o.position.toArray(),scale:o.scale.toArray()};
      }
    }
  }
  function cut(p:T.Vector2){
    if(!first){first=p.clone();updateHints();return;}
    if(p.distanceTo(first)<3)return;
    const node=sources[0], object=objects.get(node.id)!;
    const a=ray(first), b=ray(p), normal=controls.object instanceof T.OrthographicCamera?
      b.origin.clone().sub(a.origin).cross(a.direction).normalize():b.direction.clone().cross(a.direction).normalize();
    if(flip)normal.negate();
    object.updateWorldMatrix(true,false);
    const plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,a.origin).applyMatrix4(object.matrixWorld.clone().invert());
    const solid=node.solid!;
    if(solid.cuts.length>=32){end(false);hint('Достигнут предел 32 срезов');return;}
    const next={...solid,cuts:[...solid.cuts,{normal:plane.normal.toArray(),offset:-plane.constant}]};
    valid=solidFaces(next).length>=4;solidResult=next;end(true);
  }
  function move(e:PointerEvent){pointer.set(e.clientX,e.clientY);entered=true;if(mode){drawGuide();update();}}
  function down(e:PointerEvent){
    if(!mode)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(e.button===2){end(false);return;}
    if(e.button!==0)return;
    if(mode==='cut')cut(new T.Vector2(e.clientX,e.clientY));else end(true);
  }
  function key(e:KeyboardEvent){
    if(e.defaultPrevented || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('[role=dialog],.modal-backdrop'))return;
    const k=e.code, mod=e.ctrlKey||e.metaKey;
    if(mode){
      e.preventDefault();e.stopImmediatePropagation();
      if(k==='Escape'){end(false);return;}
      if(k==='Enter'||k==='NumpadEnter'){end(true);return;}
      if(mode==='cut'&&k==='KeyF')flip=!flip;
      if(['KeyX','KeyY','KeyZ'].includes(k))axis=k.slice(-1) as Axis;
      if(/^[0-9.-]$/.test(e.key))number+=e.key;
      if(k==='Backspace')number=number.slice(0,-1);
      update();updateHints();return;
    }
    const action=mod&&k==='KeyB'?'bevel':(!mod&&!e.shiftKey?({KeyG:'move',KeyR:'rotate',KeyS:'scale',KeyK:'cut',KeyE:'extend'} as Record<string,Mode>)[k]:undefined);
    if(action){e.preventDefault();begin(action);return;}
    if(!k.startsWith('Numpad')&&k!=='Home')return;
    const cam=controls.object,dir=cam.position.clone().sub(controls.target),d=dir.length();
    const view=({Numpad1:new T.Vector3(0,0,1),Numpad3:new T.Vector3(1,0,0),Numpad7:new T.Vector3(0,1,.00001)} as Record<string,T.Vector3>)[k];
    const snapshot=live().project.camera;
    let projection=snapshot.mode;
    if(view){dir.copy(view).multiplyScalar((mod?-1:1)*d);projection='orthographic';}
    else if(k==='Numpad5')projection=projection==='perspective'?'orthographic':'perspective';
    else if(k==='Home'||k==='NumpadDecimal'){
      const bounds=new T.Box3(), ids=new Set(live().selected.flatMap(id=>descendants(live().project.nodes,id)));
      for(const [id,obj] of objects)if(obj.visible&&(k==='Home'||ids.has(id)))bounds.expandByObject(obj);
      if(bounds.isEmpty())return;
      controls.target.copy(bounds.getCenter(new T.Vector3()));
      const size=bounds.getSize(new T.Vector3()).length();
      dir.setLength(Math.max(3,size*1.4));
      if(cam instanceof T.OrthographicCamera){cam.zoom=20/Math.max(2,size);cam.updateProjectionMatrix();}
    }else if(['Numpad2','Numpad4','Numpad6','Numpad8'].includes(k)){
      const spherical=new T.Spherical().setFromVector3(dir);
      if(k==='Numpad4'||k==='Numpad6')spherical.theta+=(k==='Numpad4'?-1:1)*Math.PI/12;
      else spherical.phi+=(k==='Numpad8'?-1:1)*Math.PI/12;
      spherical.makeSafe();dir.setFromSpherical(spherical);
    }else if(k==='NumpadAdd'||k==='NumpadSubtract'){
      const factor=k==='NumpadAdd'?.8:1.25;
      if(cam instanceof T.OrthographicCamera){cam.zoom/=factor;cam.updateProjectionMatrix();}else dir.multiplyScalar(factor);
    }else return;
    e.preventDefault();cam.position.copy(controls.target).add(dir);controls.update();
    live().onCamera({mode:projection,position:cam.position.toArray(),target:controls.target.toArray(),zoom:cam instanceof T.OrthographicCamera?cam.zoom:1});
  }
  const startCommand=(ev:Event)=>begin((ev as CustomEvent<Mode>).detail);
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',down,true);
  window.addEventListener('keydown',key,true);window.addEventListener('model-command',startCommand);
  const cancel=()=>{if(mode)end(false);};
  window.addEventListener('blur',cancel);
  return ()=>{guide.remove();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerdown',down,true);window.removeEventListener('keydown',key,true);window.removeEventListener('model-command',startCommand);window.removeEventListener('blur',cancel);};
}
