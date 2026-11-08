import { useState } from 'react';
import { solidDefault, solidFaces, solidNames, type Primitive, type Solid, type Point } from './solids';

export const commands = {
  select:['Выделение','V','M5 3l13 8-6 1-3 6z'],
  move:['Перемещение','G','M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3'],
  rotate:['Поворот','R','M16 7a6.5 6.5 0 1 0 .4 5M16 2v5h-5'],
  scale:['Масштаб','S','M3 11h6v6H3zM10 10l7-7m-5 0h5v5'],
  cut:['Срез плоскостью','K','M3 15l3 2L17 5l-2-2zM2 18h15'],
  bevel:['Скругление','Ctrl B','M3 17V4h14M3 16Q4 5 16 4'],
  extend:['Вытягивание грани','E','M3 11l7-3 7 3-7 3zM3 11v4l7 3 7-3v-4M10 8V1m-3 3 3-3 3 3']
} as const;
export function Glyph({name}:{name:keyof typeof commands}){
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={commands[name][2]}/></svg>;
}
export const command=(name:string)=>window.dispatchEvent(new CustomEvent('model-command',{detail:name}));
export function ToolDialog({kind,close,add}:{kind:'add'|'help';close():void;add(p:Primitive):void}){
  const rows=[['Обзор','СКМ','Вращать вид'],['','Shift СКМ','Сдвинуть вид'],['','Колесо / Ctrl СКМ','Приблизить'],['','Num 1 / 3 / 7','Спереди / справа / сверху · Ctrl для обратного вида'],['','Num 2 / 4 / 6 / 8','Повернуть вид на 15°'],['','Num 5 · Num . · Home','Проекция · к выделению · вся сцена'],['Объекты','Shift A · Tab','Добавить фигуру · режим граней'],['','G / R / S → X / Y / Z','Перенос / поворот / масштаб по оси'],['','Число → Enter · Esc / ПКМ','Точное значение · отменить операцию'],['','A / Alt A · Shift ЛКМ','Выделить всё / снять · изменить выделение'],['','Shift D · X · F2','Дублировать · удалить · переименовать'],['','H / Alt H','Скрыть выделение / показать всё'],['Геометрия','K → две точки','Срез плоскостью · F меняет сторону'],['','Ctrl B · E','Скруглить рёбра · вытянуть выбранную грань'],['Документ','Ctrl Z / Ctrl Shift Z','Отменить / повторить'],['','Ctrl S · Ctrl C / V','Сохранить · скопировать / вставить'],['','T / N','Инструменты / свойства']];
  return <div className="modal-backdrop" onMouseDown={close}><section role="dialog" aria-label={kind==='help'?'Управление':'Добавить фигуру'} className="tool-dialog" onMouseDown={e=>e.stopPropagation()}><header><h2>{kind==='help'?'Управление':'Добавить фигуру'}</h2><button onClick={close} aria-label="Закрыть">×</button></header>{kind==='add'?<div className="primitive-list">{(Object.keys(solidNames) as Primitive[]).map((p,i)=><button key={p} onClick={()=>add(p)}><span aria-hidden>{['◇','◉','▤','△'][i]}</span>{solidNames[p]}</button>)}</div>:<div className="key-table">{rows.map(([section,key,label])=><div key={key}>{section&&<h3>{section}</h3>}<kbd>{key}</kbd><span>{label}</span></div>)}</div>}</section></div>;
}
export function ShapePanel({solid,apply,editing,edit,native,busy}:{solid:Solid;apply(s:Solid):void;editing:boolean;edit():void;native?():void;busy:boolean}){
  const [axis,setAxis]=useState(0),[offset,setOffset]=useState(0),[invert,setInvert]=useState(false),[error,setError]=useState('');
  const normals:Point[]=[[1,0,0],[0,0,-1],[0,1,0]];
  function cut(){
    const sign=invert?-1:1;
    const next={...solid,cuts:[...solid.cuts,{normal:normals[axis].map(v=>v*sign) as Point,offset:offset*sign}]};
    if(solidFaces(next).length<4){setError('Срез убрал бы фигуру целиком.');return;}
    setError('');apply(next);
  }
  return <div className="inspector-section mesh-panel"><div className="section-label">Геометрия</div>
    <div className="mesh-heading"><strong>{solid.mesh?'Полигональная сетка':solidNames[solid.primitive]}</strong>{!solid.mesh&&<button onClick={edit}>{editing?'Готово':'Править грани'} <kbd>Tab</kbd></button>}</div>
    {!solid.mesh&&<><label className="range-line">Скругление<input aria-label="Скругление" type="number" min="0" max=".75" step=".025" value={solid.radius} onChange={e=>apply({...solid,radius:Math.min(.75,Math.max(0,Number(e.target.value)))})}/></label>
    <label className="range-line">Сегменты<input aria-label="Сегменты" type="number" min="1" max="8" value={solid.segments} onChange={e=>apply({...solid,segments:Math.max(1,Math.min(8,Math.round(Number(e.target.value))))})}/></label>
    <details><summary>Срез по плоскости</summary><label className="range-line">Ось<select value={axis} onChange={e=>setAxis(+e.target.value)}>{['X','Y','Z'].map((s,i)=><option key={s} value={i}>{s}</option>)}</select></label><label className="range-line">Смещение, м<input type="number" value={offset} step=".1" onChange={e=>setOffset(Number(e.target.value))}/></label><label className="check-row"><input type="checkbox" checked={invert} onChange={e=>setInvert(e.target.checked)}/>Обратная сторона</label><button onClick={cut} disabled={solid.cuts.length>=32}>Применить срез</button>{error&&<p role="status">{error}</p>}</details></>}
    {native&&<button className="native-button" disabled={busy} onClick={native}>{busy?'Открыто в Blender…':'Открыть в Blender ↗'}</button>}
  </div>;
}
export function meshInput(name:string, solid:Solid){
  if(solid.mesh)return {name,vertices:solid.mesh.vertices,faces:solid.mesh.faces};
  const vertices:Point[]=[], ids=new Map<string,number>();
  const faces=solidFaces(solid).map(f=>f.map(v=>{const key=v.toArray().map(n=>Math.round(n*1e6)).join('/');let i=ids.get(key);if(i===undefined){i=vertices.length;ids.set(key,i);vertices.push(v.toArray());}return i;}));
  return {name,vertices,faces};
}
export {solidDefault};
