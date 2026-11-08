import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Kind, MapNode, MapProject } from './model';
import { descendants } from './model';

import { solidGeometry } from './solids';
import { modelingInput } from './interaction';

export type Tool = 'select' | 'move' | 'rotate' | 'scale';
type Patch = Record<string, Partial<MapNode>>;
interface Props {
  project: MapProject;
  selected: string[];
  tool: Tool;
  editMode: boolean;
  face: number;
  onFace(index: number): void;
  placeKind: Kind | null;
  assetUrls: Record<string, string>;
  onSelect(ids: string[]): void;
  onPlace(kind: Kind, position: [number, number, number]): void;
  onTransform(patch: Patch): void;
  onCamera(camera: MapProject['camera']): void;
  onNote(id: string): void;
}

function material(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true, ...extra });
}

function addBox(group: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, color: string, radius = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (radius === 0) {
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#4b5552', transparent: true, opacity: .22 }));
    edge.position.copy(mesh.position);
    group.add(edge);
  }
  return mesh;
}

function addShape(group: THREE.Group, geometry: THREE.BufferGeometry, x: number, y: number, z: number, color: string) {
  const mesh = new THREE.Mesh(geometry, material(color, { side: THREE.DoubleSide }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function paperTexture(kind: 'tree' | 'pine' | 'bush', color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 384;
  const ctx = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  const dark = `#${base.clone().multiplyScalar(.65).getHexString()}`;
  const light = `#${base.clone().lerp(new THREE.Color('#f2e3b2'), .28).getHexString()}`;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const shape = (points: [number, number][], fill: string, line = '#263b35', width = 7) => {
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (width) { ctx.lineWidth = width; ctx.strokeStyle = line; ctx.stroke(); }
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, width = 7) => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (width) { ctx.lineWidth = width; ctx.strokeStyle = '#263b35'; ctx.stroke(); }
  };
  if (kind === 'tree') {
    shape([[142, 224], [180, 224], [183, 367], [139, 367]], '#886b53');
    shape([[149, 311], [116, 282], [104, 278], [111, 299], [142, 339]], '#886b53');
    ellipse(160, 152, 100, 104, dark);
    ellipse(112, 186, 62, 61, color);
    ellipse(212, 184, 65, 65, color);
    ellipse(160, 118, 79, 87, color);
    ellipse(107, 129, 33, 38, light, 0);
    ellipse(189, 92, 38, 24, light, 0);
    ctx.strokeStyle = '#e7e8c49c'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(98, 175); ctx.quadraticCurveTo(117, 160, 132, 168); ctx.stroke();
  } else if (kind === 'pine') {
    shape([[142, 229], [178, 229], [180, 367], [140, 367]], '#886b53');
    shape([[160, 42], [82, 187], [122, 179], [63, 269], [257, 269], [198, 179], [237, 187]], dark);
    shape([[160, 31], [94, 166], [121, 160], [73, 244], [247, 244], [199, 160], [226, 166]], color);
    shape([[160, 50], [129, 121], [145, 115], [99, 200], [127, 198]], light, light, 0);
  } else {
    ellipse(83, 278, 58, 66, dark);
    ellipse(157, 249, 94, 91, dark);
    ellipse(244, 281, 60, 63, dark);
    ellipse(88, 264, 51, 55, color);
    ellipse(163, 228, 83, 83, color);
    ellipse(239, 264, 52, 51, color);
    ellipse(134, 207, 34, 23, light, 0);
    ellipse(67, 252, 19, 17, light, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildNode(node: MapNode, url?: string, face = -1, edit = false): THREE.Group {
  const root = new THREE.Group();
  root.userData.nodeId = node.id;
  root.position.set(...node.position);
  root.rotation.set(...node.rotation);
  root.scale.set(...node.scale);
  const c = node.color;
  switch (node.kind) {
    case 'solid': {
      if (!node.solid) break;
      const mesh = new THREE.Mesh(solidGeometry(node.solid, face), [material(c), material('#ebb784')]);
      mesh.name = 'solid-body';
      root.add(mesh);
      if (edit) root.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 1), new THREE.LineBasicMaterial({color:'#37373b'})));
      break;
    }
    case 'tree': case 'pine': case 'bush': {
      const art = new THREE.Mesh(new THREE.PlaneGeometry(node.kind === 'bush' ? 2.25 : 2.5, node.kind === 'bush' ? 2.7 : 3.25),
        new THREE.MeshBasicMaterial({ map: paperTexture(node.kind, c), transparent: true, side: THREE.DoubleSide, alphaTest: .08, depthWrite: false }));
      art.position.y = node.kind === 'bush' ? 1.15 : 1.6;
      art.castShadow = true;
      root.add(art);
      break;
    }
    case 'rock':
      addShape(root, new THREE.DodecahedronGeometry(.77, 0), 0, .52, 0, c);
      break;
    case 'grass':
      for (let i = 0; i < 7; i++) {
        const blade = addShape(root, new THREE.ConeGeometry(.14, .75 + i % 3 * .14, 3), Math.sin(i * 2.4) * .3, .4, Math.cos(i * 2.4) * .3, c);
        blade.rotation.z = Math.sin(i * 2.7) * .27;
      }
      break;
    case 'flower':
      addShape(root, new THREE.CylinderGeometry(.025, .04, 1.05, 6), 0, .52, 0, '#628363');
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        addShape(root, new THREE.SphereGeometry(.22, 7, 5), Math.cos(a) * .24, 1.1 + Math.sin(a) * .24, .02, c);
      }
      addShape(root, new THREE.SphereGeometry(.16, 8, 6), 0, 1.1, .17, '#eec77e');
      break;
    case 'water':
      addBox(root, 0, .06, 0, 3, .12, 3, c);
      break;
    case 'road':
      addBox(root, 0, .055, 0, 2, .11, 3, c);
      for (let i = -1; i <= 1; i++) addBox(root, i * .54, .115, .62, .14, .02, .45, '#cbb79a', 1);
      break;
    case 'bridge':
      addBox(root, 0, .42, 0, 2.5, .22, 3.6, c);
      for (const x of [-1.12, 1.12]) for (const z of [-1.45, 1.45]) addBox(root, x, .9, z, .12, 1, .12, '#694d3b');
      for (const x of [-1.12, 1.12]) addBox(root, x, 1.27, 0, .1, .1, 3.1, '#694d3b');
      break;
    case 'fence':
      for (const x of [-1, 0, 1]) addBox(root, x, .75, 0, .15, 1.5, .16, c);
      addBox(root, 0, .95, 0, 2.2, .13, .13, c);
      addBox(root, 0, .4, 0, 2.2, .13, .13, c);
      break;
    case 'wall':
      addBox(root, 0, 1.1, 0, 3, 2.2, .44, c);
      for (const x of [-1.22, -.42, .42, 1.22]) addBox(root, x, 2.45, 0, .38, .5, .5, c);
      break;
    case 'tower':
      addShape(root, new THREE.CylinderGeometry(.83, .95, 3.2, 10), 0, 1.6, 0, c);
      addShape(root, new THREE.ConeGeometry(1.2, 1.45, 10), 0, 3.87, 0, '#7e6665');
      addBox(root, 0, .9, .87, .65, 1.2, .12, '#514d48', 1);
      break;
    case 'platform':
      addBox(root, 0, .18, 0, 4, .36, 4, '#655b4d');
      addBox(root, 0, .39, 0, 4.04, .1, 4.04, c);
      break;
    case 'sprite': {
      const texture = url ? new THREE.TextureLoader().load(url) : null;
      if (texture) texture.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.8, 1.8),
        new THREE.MeshBasicMaterial({ color: c, map: texture, transparent: true, side: THREE.DoubleSide, alphaTest: .08, depthWrite: false }),
      );
      plane.position.y = .9;
      plane.castShadow = true;
      root.add(plane);
      break;
    }
    case 'group': break;
  }
  root.traverse(child => { child.userData.nodeId = node.id; });
  return root;
}

function dispose(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of materials) {
      if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
      mat.dispose();
    }
  });
}

export function Viewport(props: Props) {
  const [hint, setHint] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const runtime = useRef<{ scene: THREE.Scene; camera: THREE.Camera; controls: OrbitControls; renderer: THREE.WebGLRenderer; objects: Map<string, THREE.Group>; highlights: THREE.BoxHelper[]; grid: THREE.Mesh } | null>(null);

  useEffect(() => {
    const element = canvas.current;
    const parent = host.current;
    if (!element || !parent) return;
    const renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 1000);
    camera.position.set(...live.current.project.camera.position);
    const controls = new OrbitControls(camera, element);
    controls.enableDamping = false;
    controls.dampingFactor = .08;
    controls.target.set(...live.current.project.camera.target);
    controls.maxPolarAngle = Math.PI;
    controls.minDistance = 2;
    controls.maxDistance = 150;
    controls.mouseButtons = {LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null};
    const middle = (e: PointerEvent) => { if(e.button === 1) controls.mouseButtons.MIDDLE = e.ctrlKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE; };
    element.addEventListener('pointerdown', middle, true);
    controls.addEventListener('end', () => {
      live.current.onCamera({ mode: live.current.project.camera.mode, zoom: controls.object instanceof THREE.OrthographicCamera ? controls.object.zoom : 1, position: controls.object.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] });
    });
    const ambient = new THREE.HemisphereLight('#f5f6ff', '#656672', 1.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#ffffff', 2.3);
    sun.position.set(-15, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), material(live.current.project.groundColor));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.06;
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.visible = false;
    scene.add(ground);
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`varying vec3 world;void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader:`varying vec3 world;
        void main(){
          vec2 p=world.xz;
          vec2 delta=max(fwidth(p),vec2(.00001));
          vec2 edge=abs(fract(p+.5)-.5)/delta;
          float fade=1.-smoothstep(35.,120.,length(world-cameraPosition));
          float fine=(1.-smoothstep(.1,1.,min(edge.x,edge.y)))*fade;
          vec3 col=vec3(.58,.59,.62);
          float x=1.-smoothstep(.3,1.4,abs(p.y)/delta.y);
          float y=1.-smoothstep(.3,1.4,abs(p.x)/delta.x);
          col=mix(col,vec3(.76,.35,.36),x);col=mix(col,vec3(.40,.64,.44),y);
          gl_FragColor=vec4(col,max(fine*.36,max(x,y)*.9*fade));
        }`
    }));
    grid.rotation.x=-Math.PI/2;grid.position.y=-.001;
    scene.add(grid);
    const objects = new Map<string, THREE.Group>();
    const highlights: THREE.BoxHelper[] = [];
    runtime.current = { scene, camera, controls, renderer, objects, highlights, grid };
    const resize = () => {
      const w = parent.clientWidth, h = parent.clientHeight;
      renderer.setSize(w, h, false);
      const active = runtime.current!.camera;
      if (active instanceof THREE.PerspectiveCamera) active.aspect = w / Math.max(h, 1);
      else if (active instanceof THREE.OrthographicCamera) { active.left = -w / Math.max(h, 1) * 13; active.right = w / Math.max(h, 1) * 13; active.top = 13; active.bottom = -13; }
      if (active instanceof THREE.PerspectiveCamera || active instanceof THREE.OrthographicCamera) active.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let drag: { ids: string[]; startX: number; startY: number; origin: THREE.Vector3; initial: Map<string, { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }>; tool: Tool } | null = null;
    const point = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, runtime.current!.camera);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.altKey) return;
      point(event);
      const r = runtime.current!;
      const meshes = [...r.objects.values()].filter(obj => obj.visible);
      const picked = raycaster.intersectObjects(meshes, true).find(intersection => {
        const id = intersection.object.userData.nodeId as string | undefined;
        return intersection.object instanceof THREE.Mesh && id && !live.current.project.nodes.find(node => node.id === id)?.locked;
      });
      const id = picked?.object.userData.nodeId as string | undefined;
      if (live.current.placeKind) {
        plane.constant = 0;
        if (raycaster.ray.intersectPlane(plane, hit)) {
          const snap = live.current.project.snap;
          live.current.onPlace(live.current.placeKind, [snap ? Math.round(hit.x) : +hit.x.toFixed(2), 0, snap ? Math.round(hit.z) : +hit.z.toFixed(2)]);
        }
        return;
      }
      if (live.current.editMode) {
        if (id === live.current.selected[0] && picked?.object instanceof THREE.Mesh && picked.faceIndex != null)
          live.current.onFace(picked.object.geometry.userData.faces?.[picked.faceIndex] ?? -1);
        return;
      }
      if (!id) { if (!event.shiftKey) live.current.onSelect([]); return; }
      if (event.shiftKey) {
        const old = live.current.selected;
        live.current.onSelect(old.includes(id) ? old.filter(value => value !== id) : [...old, id]);
        return;
      }
      const selected = live.current.selected.includes(id) ? live.current.selected : [id];
      live.current.onSelect(selected);
      if (live.current.tool === 'select') return;
      const ids = [...new Set(selected.flatMap(value => descendants(live.current.project.nodes, value)))].filter(value => r.objects.has(value));
      const initial = new Map<string, { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }>();
      for (const value of ids) {
        const obj = r.objects.get(value)!;
        initial.set(value, { position: obj.position.clone(), rotation: obj.rotation.clone(), scale: obj.scale.clone() });
      }
      plane.constant = -r.objects.get(id)!.position.y;
      if (!raycaster.ray.intersectPlane(plane, hit)) hit.set(0, 0, 0);
      drag = { ids, startX: event.clientX, startY: event.clientY, origin: hit.clone(), initial, tool: live.current.tool };
      controls.enabled = false;
      element.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const r = runtime.current!;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.tool === 'move') {
        point(event);
        if (!raycaster.ray.intersectPlane(plane, hit)) return;
        const delta = hit.clone().sub(drag.origin);
        for (const id of drag.ids) r.objects.get(id)!.position.copy(drag.initial.get(id)!.position).add(delta);
      } else if (drag.tool === 'rotate') {
        for (const id of drag.ids) r.objects.get(id)!.rotation.y = drag.initial.get(id)!.rotation.y + dx * .012;
      } else {
        const factor = Math.max(.1, 1 + (dx - dy) * .008);
        for (const id of drag.ids) r.objects.get(id)!.scale.copy(drag.initial.get(id)!.scale).multiplyScalar(factor);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!drag) return;
      const patch: Patch = {};
      for (const id of drag.ids) {
        const object = runtime.current!.objects.get(id)!;
        if (drag.tool === 'move') {
          const p = object.position.toArray() as [number, number, number];
          patch[id] = { position: live.current.project.snap ? [Math.round(p[0] * 2) / 2, p[1], Math.round(p[2] * 2) / 2] : p.map(v => +v.toFixed(3)) as [number, number, number] };
        } else if (drag.tool === 'rotate') patch[id] = { rotation: object.rotation.toArray().slice(0, 3) as [number, number, number] };
        else patch[id] = { scale: object.scale.toArray() as [number, number, number] };
      }
      drag = null;
      controls.enabled = true;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      live.current.onTransform(patch);
    };
    const unbind = modelingInput(element, controls, objects, () => live.current, setHint);
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    const preventContext = (event: MouseEvent) => event.preventDefault();
    element.addEventListener('contextmenu', preventContext);
    let frame = 0;
    const axisButtons = [...parent.querySelectorAll<HTMLButtonElement>('[data-axis]')];
    const axisVectors = [new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0)];
    const inverse = new THREE.Quaternion(), vector=new THREE.Vector3();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      for (const node of live.current.project.nodes) if (['sprite', 'tree', 'pine', 'bush'].includes(node.kind) && node.billboard) {
        const object = rObject(node.id);
        if (object) object.rotation.y = Math.atan2(runtime.current!.camera.position.x - object.position.x, runtime.current!.camera.position.z - object.position.z);
      }
      for (const box of runtime.current?.highlights ?? []) box.update();
      const activeCamera=runtime.current!.camera;
      renderer.render(scene, activeCamera);
      inverse.copy(activeCamera.quaternion).invert();
      axisButtons.forEach((button,index)=>{
        vector.copy(axisVectors[index]).applyQuaternion(inverse);
        button.style.transform='translate('+Math.round(vector.x*25)+'px,'+Math.round(-vector.y*25)+'px)';
        button.style.zIndex=vector.z>0?'3':'1';
      });
      const pins = parent.querySelectorAll<HTMLElement>('[data-note-id]');
      for (const pin of pins) {
        const note = live.current.project.notes.find(value => value.id === pin.dataset.noteId);
        if (!note || !note.visible) { pin.style.display = 'none'; continue; }
        const node = note.targetId ? live.current.project.nodes.find(value => value.id === note.targetId) : null;
        const pos = new THREE.Vector3(...(node?.position ?? note.position));
        pos.y += node ? 2.4 : .4;
        pos.project(runtime.current!.camera);
        const visible = pos.z < 1 && pos.z > -1;
        pin.style.display = visible ? '' : 'none';
        pin.style.left = `${(pos.x + 1) * .5 * parent.clientWidth}px`;
        pin.style.top = `${(1 - pos.y) * .5 * parent.clientHeight}px`;
      }
    };
    const rObject = (id: string) => runtime.current?.objects.get(id);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      unbind(); element.removeEventListener('pointerdown',middle,true);
      observer.disconnect();
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('contextmenu', preventContext);
      controls.dispose();
      for (const object of objects.values()) { scene.remove(object); dispose(object); }
      for (const box of highlights) { scene.remove(box); dispose(box); }
      ground.geometry.dispose(); (ground.material as THREE.Material).dispose();
      dispose(grid);
      renderer.dispose();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    for (const object of r.objects.values()) { r.scene.remove(object); dispose(object); }
    r.objects.clear();
    for (const node of props.project.nodes) {
      if (node.kind === 'group') continue;
      const edit = props.editMode && props.selected.includes(node.id);
      const object = buildNode(node, node.assetId ? props.assetUrls[node.assetId] : undefined, edit ? props.face : -1, edit);
      let ancestor = node.parentId;
      let visible = node.visible;
      while (ancestor) {
        const parent = props.project.nodes.find(item => item.id === ancestor);
        if (!parent) break;
        visible &&= parent.visible;
        ancestor = parent.parentId;
      }
      object.visible = visible;
      r.scene.add(object);
      r.objects.set(node.id, object);
    }
    const ground = r.scene.getObjectByName('ground') as THREE.Mesh;
    (ground.material as THREE.MeshStandardMaterial).color.set(props.project.groundColor);
    r.scene.background = new THREE.Color('#404145');
    r.grid.visible = props.project.grid;
  }, [props.project.nodes, props.project.groundColor, props.project.skyColor, props.project.grid, props.assetUrls, props.editMode, props.face, props.selected]);

  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    for (const box of r.highlights) { r.scene.remove(box); dispose(box); }
    r.highlights.length = 0;
    const ids = [...new Set(props.selected.flatMap(id => descendants(props.project.nodes, id)))];
    for (const id of ids) {
      const object = r.objects.get(id);
      if (!object) continue;
      const box = new THREE.BoxHelper(object, '#e6b57c');
      r.scene.add(box);
      r.highlights.push(box);
    }
  }, [props.selected, props.project.nodes, props.editMode, props.face, props.assetUrls, props.project.grid]);

  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    const old = r.camera;
    const w = host.current?.clientWidth ?? 1, h = host.current?.clientHeight ?? 1;
    const camera = props.project.camera.mode === 'orthographic'
      ? new THREE.OrthographicCamera(-w / h * 13, w / h * 13, 13, -13, .1, 1000)
      : new THREE.PerspectiveCamera(48, w / h, .1, 1000);
    camera.position.copy(old.position);
    if (camera instanceof THREE.OrthographicCamera) { camera.zoom=props.project.camera.zoom ?? 1; camera.updateProjectionMatrix(); }
    r.camera = camera;
    r.controls.object = camera;
    r.controls.update();
  }, [props.project.camera.mode]);

  return <div ref={host} className="viewport" aria-label="3D-холст">
    <canvas ref={canvas} className="viewport-canvas" />
    <div className="axis-navigator" aria-label="Вид по оси">{['X','Y','Z'].map((a,i)=><button key={a} data-axis={a} title={['Вид справа','Вид спереди','Вид сверху'][i]} onClick={()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:['Numpad3','Numpad1','Numpad7'][i],bubbles:true}))}>{a}</button>)}</div>
    <div className="viewport-hint">{hint || (props.editMode ? 'Выберите грань · E вытянуть · K срез · Ctrl B скруглить' : 'СКМ — вращать · Shift СКМ — сдвиг · Колесо — приблизить')}</div>
    {props.project.notes.filter(note => note.visible).map(note =>
      <button key={note.id} data-note-id={note.id} className="note-pin" onClick={() => props.onNote(note.id)} title={note.body || note.title}>✦ {note.title}</button>
    )}
    {props.placeKind && <div className="place-hint">Нажмите на карте, чтобы поставить объект · Esc — выйти</div>}
  </div>;
}
