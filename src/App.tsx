import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AssetMeta, Kind, MapNode, MapNote, MapProject, NoteType } from './model';
import { defaultColors, descendants, names, newNode, newProject } from './model';
import { Viewport, type Tool } from './Viewport';
import { deleteProject, listProjects, loadAsset, loadProject, saveAsset, saveProject, storeImportedProject } from './storage';
import { exportArchive, importArchive } from './archive';
import './styles.css';

const icon: Record<Kind, string> = {
  tree: '🌳', pine: '🌲', bush: '🌿', rock: '🪨', grass: '🌾', flower: '✿', water: '≈', road: '▰',
  bridge: '⌁', fence: '♜', wall: '▥', tower: '♖', platform: '▣', sprite: '▧', group: '▤',
};
const categories: { title: string; kinds: Kind[] }[] = [
  { title: 'Природа', kinds: ['tree', 'pine', 'bush', 'rock', 'grass', 'flower'] },
  { title: 'Поверхности', kinds: ['water', 'road', 'platform'] },
  { title: 'Постройки', kinds: ['bridge', 'fence', 'wall', 'tower'] },
];
const noteTypes: Record<NoteType, string> = { idea: 'Идея', task: 'Задача', behavior: 'Поведение', story: 'Сюжет', question: 'Вопрос' };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function NumericField({ label, value, step = .1, onCommit }: { label: string; value: number; step?: number; onCommit(value: number): void }) {
  return <label className="number-field"><span>{label}</span><input key={`${label}:${value}`} type="number" step={step} defaultValue={Number(value.toFixed(3))} onBlur={event => {
    const result = Number(event.currentTarget.value);
    if (Number.isFinite(result) && result !== value) onCommit(result);
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function App() {
  const [project, setProject] = useState<MapProject | null>(null);
  const projectRef = useRef<MapProject | null>(null);
  projectRef.current = project;
  const [projects, setProjects] = useState<MapProject[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [placeKind, setPlaceKind] = useState<Kind | null>(null);
  const [leftTab, setLeftTab] = useState<'library' | 'layers' | 'notes'>('library');
  const [status, setStatus] = useState('Готово');
  const [toast, setToast] = useState('');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const archiveInput = useRef<HTMLInputElement>(null);
  const pngInput = useRef<HTMLInputElement>(null);
  const history = useRef<{ past: MapProject[]; future: MapProject[] }>({ past: [], future: [] });
  const clipboard = useRef<MapNode[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);

  useEffect(() => { listProjects().then(setProjects).catch(() => setStatus('Хранилище недоступно')); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const queueSave = useCallback((snapshot: MapProject, version: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('Сохранение…');
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      await saveProject(snapshot);
      savedRevision.current = version;
      if (version === revision.current) setStatus('Все изменения сохранены');
      setProjects(old => [snapshot, ...old.filter(item => item.id !== snapshot.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }).catch(error => {
      setStatus('Ошибка сохранения — скачайте архив');
      setToast(error instanceof Error ? error.message : 'Не удалось сохранить карту.');
    });
    return saveQueue.current;
  }, []);

  const commit = useCallback((change: (old: MapProject) => MapProject, undoable = true) => {
    const old = projectRef.current;
    if (!old) return;
    const changed = change(old);
    if (changed === old) return;
    if (undoable) {
      history.current.past.push(old);
      if (history.current.past.length > 80) history.current.past.shift();
      history.current.future = [];
    }
    const next = { ...changed, updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
    const version = ++revision.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('Не сохранено');
    saveTimer.current = setTimeout(() => queueSave(next, version), 800);
  }, [queueSave]);

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const current = projectRef.current;
    if (current && savedRevision.current !== revision.current) await queueSave(current, revision.current);
    else await saveQueue.current;
  }, [queueSave]);

  const open = async (next: MapProject) => {
    await flush();
    projectRef.current = next;
    setProject(next);
    history.current = { past: [], future: [] };
    revision.current = 0;
    savedRevision.current = 0;
    setSelected([]); setSelectedNote(null); setPlaceKind(null);
    setStatus('Все изменения сохранены');
    try { setCollapsed(JSON.parse(localStorage.getItem(`map-collapsed:${next.id}`) || '[]')); }
    catch { setCollapsed([]); }
  };

  useEffect(() => {
    if (!project) { setAssetUrls({}); return; }
    let disposed = false;
    const urls: Record<string, string> = {};
    Promise.all(project.assets.map(async asset => {
      const blob = await loadAsset(project.id, asset.id);
      if (blob) urls[asset.id] = URL.createObjectURL(blob);
    })).then(() => {
      if (disposed) Object.values(urls).forEach(URL.revokeObjectURL);
      else setAssetUrls(urls);
    }).catch(() => setToast('Не удалось загрузить один из рисунков.'));
    return () => { disposed = true; Object.values(urls).forEach(URL.revokeObjectURL); };
  }, [project?.id, project?.assets]);

  const create = async () => {
    const next = newProject();
    await flush();
    await saveProject(next);
    setProjects(old => [next, ...old]);
    await open(next);
  };
  const returnHome = async () => { await flush(); projectRef.current = null; setProject(null); setSelected([]); setShowFiles(false); setProjects(await listProjects()); };
  const choose = async (id: string) => { const next = await loadProject(id); if (next) await open(next); };
  const remove = async (item: MapProject) => {
    if (!window.confirm(`Удалить карту «${item.name}» и все её рисунки с этого устройства?`)) return;
    await deleteProject(item);
    setProjects(old => old.filter(value => value.id !== item.id));
  };

  const add = (kind: Kind, position: [number, number, number]) => {
    const node = newNode(kind, position);
    commit(old => ({ ...old, nodes: [...old.nodes, node] }));
    setSelected([node.id]);
    setSelectedNote(null);
    setPlaceKind(null);
    setLeftTab('layers');
  };
  const patchNodes = (patch: Record<string, Partial<MapNode>>) => commit(old => {
    const expanded: Record<string, Partial<MapNode>> = { ...patch };
    for (const [id, change] of Object.entries(patch)) {
      const group = old.nodes.find(node => node.id === id && node.kind === 'group');
      if (!group) continue;
      for (const childId of descendants(old.nodes, id).slice(1)) {
        const child = old.nodes.find(node => node.id === childId)!;
        const childChange: Partial<MapNode> = { ...expanded[childId] };
        if (change.position) {
          const delta = change.position.map((value, i) => value - group.position[i]);
          childChange.position = child.position.map((value, i) => value + delta[i]) as [number, number, number];
        }
        if (change.rotation && change.rotation[1] !== group.rotation[1]) {
          const angle = change.rotation[1] - group.rotation[1];
          const dx = child.position[0] - group.position[0], dz = child.position[2] - group.position[2];
          childChange.position = [group.position[0] + dx * Math.cos(angle) - dz * Math.sin(angle), child.position[1], group.position[2] + dx * Math.sin(angle) + dz * Math.cos(angle)];
          childChange.rotation = [child.rotation[0], child.rotation[1] + angle, child.rotation[2]];
        }
        if (change.scale) {
          const ratio = change.scale.map((value, i) => value / group.scale[i]);
          childChange.position = child.position.map((value, i) => group.position[i] + (value - group.position[i]) * ratio[i]) as [number, number, number];
          childChange.scale = child.scale.map((value, i) => value * ratio[i]) as [number, number, number];
        }
        if (change.color) childChange.color = change.color;
        expanded[childId] = childChange;
      }
    }
    return { ...old, nodes: old.nodes.map(node => expanded[node.id] ? { ...node, ...expanded[node.id] } : node) };
  });
  const patchSelected = (changes: Partial<MapNode>) => patchNodes(Object.fromEntries(selected.map(id => [id, changes])));
  const patchNote = (changes: Partial<MapNote>) => commit(old => ({ ...old, notes: old.notes.map(note => note.id === selectedNote ? { ...note, ...changes } : note) }));

  const addNote = (targetId: string | null = null) => {
    const note: MapNote = { id: crypto.randomUUID(), title: 'Новая заметка', body: '', type: 'idea', targetId, position: [0, 0, 0], visible: true };
    commit(old => ({ ...old, notes: [...old.notes, note] }));
    setSelectedNote(note.id); setLeftTab('notes');
  };

  const groupSelection = () => {
    if (!project || selected.length === 0) return;
    const selectedSet = new Set(selected);
    const roots = selected.filter(id => {
      let parent = project.nodes.find(node => node.id === id)?.parentId;
      while (parent) {
        if (selectedSet.has(parent)) return false;
        parent = project.nodes.find(node => node.id === parent)?.parentId ?? null;
      }
      return true;
    });
    const centers = roots.map(id => project.nodes.find(node => node.id === id)!.position);
    const group = newNode('group', [0, 0, 0], { position: [0, 1, 2].map(i => centers.reduce((sum, point) => sum + point[i], 0) / centers.length) as [number, number, number] });
    commit(old => ({ ...old, nodes: [...old.nodes.map(node => roots.includes(node.id) ? { ...node, parentId: group.id } : node), group] }));
    setSelected([group.id]); setLeftTab('layers');
  };
  const ungroup = () => {
    if (!project) return;
    const groups = project.nodes.filter(node => selected.includes(node.id) && node.kind === 'group');
    if (!groups.length) return;
    commit(old => ({ ...old,
      nodes: old.nodes.filter(node => !groups.some(group => group.id === node.id)).map(node => {
        const parent = groups.find(group => group.id === node.parentId);
        return parent ? { ...node, parentId: parent.parentId } : node;
      }),
      notes: old.notes.map(note => groups.some(group => group.id === note.targetId) ? { ...note, targetId: null } : note),
    }));
    setSelected([]);
  };
  const removeSelected = () => {
    if (!project || !selected.length) return;
    const ids = new Set(selected.flatMap(id => descendants(project.nodes, id)));
    commit(old => ({ ...old, nodes: old.nodes.filter(node => !ids.has(node.id)), notes: old.notes.map(note => note.targetId && ids.has(note.targetId) ? { ...note, targetId: null } : note) }));
    setSelected([]);
  };
  const duplicate = () => {
    if (!project || !selected.length) return;
    const ids = [...new Set(selected.flatMap(id => descendants(project.nodes, id)))];
    const sources = project.nodes.filter(node => ids.includes(node.id));
    clipboard.current = sources.map(node => structuredClone(node));
    paste();
  };
  const paste = () => {
    if (!clipboard.current.length) return;
    const ids = new Map(clipboard.current.map(node => [node.id, crypto.randomUUID()]));
    const copies = clipboard.current.map(node => ({ ...structuredClone(node), id: ids.get(node.id)!, name: `${node.name} — копия`, parentId: node.parentId && ids.has(node.parentId) ? ids.get(node.parentId)! : node.parentId, position: [node.position[0] + 1, node.position[1], node.position[2] + 1] as [number, number, number] }));
    commit(old => ({ ...old, nodes: [...old.nodes, ...copies] }));
    setSelected(copies.filter(node => !node.parentId || !ids.has(node.parentId)).map(node => node.id));
  };
  const undo = () => {
    const previous = history.current.past.pop(), current = projectRef.current;
    if (!previous || !current) return;
    history.current.future.push(current);
    projectRef.current = previous; setProject(previous); setSelected([]);
    const version = ++revision.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => queueSave(previous, version), 800);
  };
  const redo = () => {
    const next = history.current.future.pop(), current = projectRef.current;
    if (!next || !current) return;
    history.current.past.push(current);
    projectRef.current = next; setProject(next); setSelected([]);
    const version = ++revision.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => queueSave(next, version), 800);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!projectRef.current) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') { setPlaceKind(null); setSelectedNote(null); return; }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); const current = projectRef.current; if (current) clipboard.current = current.nodes.filter(node => [...new Set(selected.flatMap(id => descendants(current.nodes, id)))].includes(node.id)).map(node => structuredClone(node)); }
      else if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const exportZip = async () => {
    if (!project) return;
    try {
      await flush();
      setStatus('Подготовка архива…');
      const canvas = document.querySelector<HTMLCanvasElement>('.viewport-canvas');
      const preview = await new Promise<Blob | null>(resolve => { if (canvas) canvas.toBlob(resolve, 'image/png'); else resolve(null); });
      const blob = await exportArchive(projectRef.current!, preview);
      download(blob, `${project.name.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 60)}.mgmap.zip`);
      setStatus('Все изменения сохранены');
      setToast('Архив подготовлен. Скачивание начато.');
    } catch (error) { setStatus('Ошибка экспорта'); setToast(error instanceof Error ? error.message : 'Не удалось экспортировать карту.'); }
  };
  const importZip = async (file?: File) => {
    if (!file) return;
    try {
      const { project: imported, images } = await importArchive(file);
      await flush();
      await storeImportedProject(imported, images);
      await open(imported);
      setProjects(await listProjects());
      setToast('Карта импортирована со всеми объектами и рисунками.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Архив не открылся. Текущая карта сохранена.'); }
    if (archiveInput.current) archiveInput.current.value = '';
  };
  const importPng = async (file?: File) => {
    if (!file || !project) return;
    if (file.type !== 'image/png' || file.size > 8 * 1024 * 1024) { setToast('Нужен PNG размером до 8 МиБ.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width, height = bitmap.height;
      bitmap.close();
      if (width > 8192 || height > 8192) throw new Error('Изображение слишком большое.');
      const meta: AssetMeta = { id: crypto.randomUUID(), name: file.name.slice(0, 120), mime: 'image/png', width, height };
      await saveAsset(project.id, meta.id, file);
      const node = newNode('sprite', [0, 0, 0], { name: file.name.replace(/\.png$/i, ''), assetId: meta.id, billboard: true, scale: [Math.max(.5, Math.min(5, width / 256)), Math.max(.5, Math.min(5, height / 256)), 1] });
      commit(old => ({ ...old, assets: [...old.assets, meta], nodes: [...old.nodes, node] }));
      setSelected([node.id]); setLeftTab('layers');
      setToast('Рисунок добавлен. Его можно двигать и поворачивать.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Не удалось открыть PNG.'); }
    if (pngInput.current) pngInput.current.value = '';
  };

  const toggleCollapsed = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter(value => value !== id) : [...collapsed, id];
    setCollapsed(next);
    if (project) try { localStorage.setItem(`map-collapsed:${project.id}`, JSON.stringify(next)); } catch { /* optional workspace preference */ }
  };
  const renderTree = (parentId: string | null, depth = 0): ReactNode => project?.nodes.filter(node => node.parentId === parentId).map(node => {
    const children = project.nodes.some(other => other.parentId === node.id);
    return <div key={node.id}>
      <div className={`layer-row ${selected.includes(node.id) ? 'selected' : ''} ${node.visible ? '' : 'muted'}`} style={{ paddingLeft: 11 + depth * 16 }}>
        {children ? <button className="fold" onClick={() => toggleCollapsed(node.id)} aria-label={collapsed.includes(node.id) ? 'Развернуть группу' : 'Свернуть группу'}>{collapsed.includes(node.id) ? '▸' : '▾'}</button> : <span className="fold" aria-hidden="true">·</span>}
        <button className="layer-name" onClick={event => { setSelected(event.shiftKey ? selected.includes(node.id) ? selected.filter(id => id !== node.id) : [...selected, node.id] : [node.id]); setSelectedNote(null); }}>{icon[node.kind]} <span>{node.name}</span></button>
        <button className="layer-action" title={node.visible ? 'Скрыть' : 'Показать'} onClick={() => patchNodes({ [node.id]: { visible: !node.visible } })}>{node.visible ? '◉' : '○'}</button>
      </div>
      {!collapsed.includes(node.id) && renderTree(node.id, depth + 1)}
    </div>;
  });

  const selectedNode = project?.nodes.find(node => node.id === selected[0]);
  const note = project?.notes.find(item => item.id === selectedNote);

  if (!project) return <main className="home-shell">
    <header className="home-header"><div className="brand-mark">M</div><div className="brand-name">Мастерская карт<span>3D редактор уровней</span></div><div className="home-version">Формат проекта 1.0</div></header>
    <section className="home-hero"><div className="hero-eyebrow">МИР НАЧИНАЕТСЯ С КАРТЫ</div><h1>Соберите место,<br /><em>в котором будет история.</em></h1><p>Расставляйте декорации, прикрепляйте идеи к объектам и сохраняйте карту как понятный план будущего уровня.</p><div className="home-actions"><button className="primary-button" onClick={create}>＋ Создать карту</button><button className="secondary-button" onClick={() => archiveInput.current?.click()}>↥ Импортировать архив</button></div></section>
    <section className="projects-section"><div className="section-heading"><div><span>ВАШИ ПРОЕКТЫ</span><h2>Продолжить работу</h2></div><span className="project-count">{projects.length} карт</span></div><div className="project-grid">{projects.length ? projects.map(item => <article className="project-card" key={item.id}><button className="project-open" onClick={() => choose(item.id)}><div className="project-art"><div className="art-sun" /><div className="art-hill one" /><div className="art-hill two" /><div className="art-tree">♠</div></div><strong>{item.name}</strong><span>{item.nodes.length} объектов · {item.notes.length} заметок</span><small>Изменена {new Date(item.updatedAt).toLocaleString('ru-RU')}</small></button><button className="card-delete" onClick={() => remove(item)} title="Удалить карту">×</button></article>) : <div className="empty-projects"><span>◇</span><strong>Здесь появятся ваши карты</strong><p>Начните с пустой сцены и расставьте первые объекты.</p></div>}</div></section>
    <input ref={archiveInput} type="file" accept=".zip,.mgmap.zip,application/zip" hidden onChange={event => importZip(event.target.files?.[0])} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;

  return <div className="app-shell">
    <header className="editor-header"><button className="logo-button" onClick={returnHome} title="К списку карт"><span className="brand-mark small">M</span><span>Карты</span></button><div className="header-separator" /><input className="document-title" aria-label="Название карты" value={project.name} onChange={event => commit(old => ({ ...old, name: event.target.value || 'Новая карта' }))} /><span className={`save-state ${status.includes('Ошибка') ? 'error' : ''}`}><i />{status}</span><div className="header-spacer" /><button className="header-button" onClick={() => setShowFiles(true)}>Файлы</button><button className="header-button" onClick={exportZip}>↥ Экспорт карты</button></header>
    <div className="editor-body">
      <aside className="left-panel"><div className="panel-tabs"><button className={leftTab === 'library' ? 'active' : ''} onClick={() => setLeftTab('library')}>Декор</button><button className={leftTab === 'layers' ? 'active' : ''} onClick={() => setLeftTab('layers')}>Сцена</button><button className={leftTab === 'notes' ? 'active' : ''} onClick={() => setLeftTab('notes')}>Заметки</button></div>
        {leftTab === 'library' && <div className="panel-scroll library-panel"><div className="panel-intro"><strong>Библиотека объектов</strong><p>Выберите объект и нажмите на карте, чтобы поставить его.</p></div>{categories.map(category => <section className="library-category" key={category.title}><h3>{category.title}</h3><div className="prefab-grid">{category.kinds.map(kind => <button key={kind} className={`prefab ${placeKind === kind ? 'active' : ''}`} onClick={() => setPlaceKind(placeKind === kind ? null : kind)}><span className="prefab-icon" style={{ '--prefab-color': defaultColors[kind] } as CSSProperties}>{icon[kind]}</span><span>{names[kind]}</span></button>)}</div></section>)}<button className="import-art" onClick={() => pngInput.current?.click()}>＋ Добавить свой PNG</button><p className="library-footnote">Свои рисунки остаются в браузере и входят в архив карты.</p></div>}
        {leftTab === 'layers' && <div className="panel-scroll"><div className="scene-heading"><strong>Объекты сцены</strong><span>{project.nodes.length}</span></div><div className="layer-toolbar"><button onClick={groupSelection} disabled={!selected.length} title="Группа">▤ Группа</button><button onClick={ungroup} disabled={!selected.some(id => project.nodes.find(node => node.id === id)?.kind === 'group')}>Разгруппировать</button></div>{project.nodes.length ? <div className="layer-tree">{renderTree(null)}</div> : <div className="side-empty">Добавьте первый объект из библиотеки.</div>}<div className="side-help">Shift + клик — несколько объектов<br />Ctrl+C / Ctrl+V — копировать / вставить</div></div>}
        {leftTab === 'notes' && <div className="panel-scroll notes-panel"><div className="scene-heading"><strong>Заметки карты</strong><button className="small-add" onClick={() => addNote(selected[0] ?? null)}>＋</button></div>{project.notes.length ? project.notes.map(item => <button key={item.id} className={`note-list-item ${selectedNote === item.id ? 'active' : ''}`} onClick={() => { setSelectedNote(item.id); setSelected(item.targetId ? [item.targetId] : []); }}><span className="note-type-dot" /><strong>{item.title}</strong><small>{item.targetId ? project.nodes.find(node => node.id === item.targetId)?.name ?? 'Объект' : 'Вся карта'} · {noteTypes[item.type]}</small></button>) : <div className="side-empty">Прикрепите идею к объекту или оставьте заметку для всей карты.</div>}</div>}
      </aside>
      <main className="work-area"><div className="tool-strip"><div className="tool-group"><button className={tool === 'move' ? 'active' : ''} onClick={() => { setTool('move'); setPlaceKind(null); }}>↔ <span>Переместить</span></button><button className={tool === 'rotate' ? 'active' : ''} onClick={() => { setTool('rotate'); setPlaceKind(null); }}>⟳ <span>Повернуть</span></button><button className={tool === 'scale' ? 'active' : ''} onClick={() => { setTool('scale'); setPlaceKind(null); }}>⤢ <span>Размер</span></button></div><div className="tool-divider" /><button className={project.snap ? 'toggle-on' : ''} onClick={() => commit(old => ({ ...old, snap: !old.snap }), false)}>⌗ <span>Привязка</span></button><button className={project.grid ? 'toggle-on' : ''} onClick={() => commit(old => ({ ...old, grid: !old.grid }), false)}>▦ <span>Сетка</span></button><div className="tool-spacer" /><button onClick={() => commit(old => ({ ...old, camera: { ...old.camera, mode: old.camera.mode === 'perspective' ? 'orthographic' : 'perspective' } }), false)}>{project.camera.mode === 'perspective' ? 'Перспектива' : 'Ортографический'}⌄</button></div>
        <Viewport project={project} selected={selected} tool={tool} placeKind={placeKind} assetUrls={assetUrls} onSelect={ids => { setSelected(ids); setSelectedNote(null); }} onPlace={add} onTransform={patchNodes} onCamera={camera => commit(old => ({ ...old, camera }), false)} onNote={id => { setSelectedNote(id); setLeftTab('notes'); }} />
        <footer className="status-bar"><span>1 единица = 1 метр</span><span>{project.nodes.length} объектов · {project.notes.length} заметок</span><span>Проект хранится на этом устройстве</span></footer>
      </main>
      <aside className="right-panel"><div className="inspector-heading">Свойства <span>{selected.length > 1 ? `${selected.length} объектов` : selectedNode ? names[selectedNode.kind] : note ? 'Заметка' : 'Карта'}</span></div><div className="panel-scroll inspector-scroll">
        {note ? <><div className="inspector-section"><div className="section-label">ЗАМЕТКА</div><label className="field-label">Название<input value={note.title} onChange={event => patchNote({ title: event.target.value })} /></label><label className="field-label">Тип<select value={note.type} onChange={event => patchNote({ type: event.target.value as NoteType })}>{Object.entries(noteTypes).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="field-label">Привязка<select value={note.targetId ?? ''} onChange={event => patchNote({ targetId: event.target.value || null })}><option value="">Вся карта</option>{project.nodes.map(node => <option value={node.id} key={node.id}>{node.name}</option>)}</select></label><label className="field-label">Описание<textarea rows={8} value={note.body} onChange={event => patchNote({ body: event.target.value })} placeholder="Что должно происходить здесь?" /></label><label className="check-row"><input type="checkbox" checked={note.visible} onChange={event => patchNote({ visible: event.target.checked })} /> Показывать на карте</label><button className="danger-button" onClick={() => { commit(old => ({ ...old, notes: old.notes.filter(item => item.id !== note.id) })); setSelectedNote(null); }}>Удалить заметку</button></div></> : selectedNode ? <><div className="inspector-section"><div className="section-label">ОБЪЕКТ</div><label className="field-label">Название<input value={selectedNode.name} onChange={event => patchSelected({ name: event.target.value })} /></label><div className="property-id">ID: {selectedNode.id}</div><div className="check-grid"><label><input type="checkbox" checked={selectedNode.visible} onChange={event => patchSelected({ visible: event.target.checked })} /> Видимый</label><label><input type="checkbox" checked={selectedNode.locked} onChange={event => patchSelected({ locked: event.target.checked })} /> Заблокирован</label></div></div><div className="inspector-section"><div className="section-label">ПРЕОБРАЗОВАНИЕ</div><div className="property-caption">Положение · метры</div><div className="number-grid">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumericField key={`pos${axis}:${selectedNode.id}`} label={axis} value={selectedNode.position[i]} onCommit={value => patchSelected({ position: selectedNode.position.map((n, index) => i === index ? value : n) as [number, number, number] })} />)}</div><div className="property-caption">Поворот · градусы</div><div className="number-grid">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumericField key={`rot${axis}:${selectedNode.id}`} label={axis} value={selectedNode.rotation[i] * 180 / Math.PI} step={1} onCommit={value => patchSelected({ rotation: selectedNode.rotation.map((n, index) => i === index ? value * Math.PI / 180 : n) as [number, number, number] })} />)}</div><div className="property-caption">Размер</div><div className="number-grid">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumericField key={`scale${axis}:${selectedNode.id}`} label={axis} value={selectedNode.scale[i]} onCommit={value => patchSelected({ scale: selectedNode.scale.map((n, index) => i === index ? Math.max(.05, value) : n) as [number, number, number] })} />)}</div></div><div className="inspector-section"><div className="section-label">ВНЕШНИЙ ВИД</div><label className="color-field"><input type="color" value={selectedNode.color} onChange={event => patchSelected({ color: event.target.value })} /><span>Цвет объекта</span><code>{selectedNode.color}</code></label>{['sprite', 'tree', 'pine', 'bush'].includes(selectedNode.kind) && <label className="check-row"><input type="checkbox" checked={selectedNode.billboard ?? false} onChange={event => patchSelected({ billboard: event.target.checked })} /> Поворачивать к камере</label>}</div><div className="inspector-section"><div className="section-label">ДЛЯ БУДУЩЕЙ ИГРЫ</div><div className="check-grid vertical">{([['collision', 'Коллизия'], ['walkable', 'Проходная область'], ['spawn', 'Точка появления'], ['interactive', 'Интерактивный']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={selectedNode[key]} onChange={event => patchSelected({ [key]: event.target.checked })} /> {label}</label>)}</div><label className="field-label">Переход на карту<input value={selectedNode.transitionTo} onChange={event => patchSelected({ transitionTo: event.target.value })} placeholder="Название другой карты" /></label><label className="field-label">Метки через запятую<input value={selectedNode.tags.join(', ')} onChange={event => patchSelected({ tags: event.target.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 20) })} placeholder="лес, вход, квест" /></label></div><div className="inspector-actions"><button onClick={() => addNote(selectedNode.id)}>✦ Прикрепить заметку</button><button onClick={duplicate}>⧉ Дублировать</button><button className="danger-button" onClick={removeSelected}>Удалить объект</button></div></> : <><div className="inspector-section"><div className="section-label">ОБ ЭТОЙ КАРТЕ</div><p className="inspector-copy">Выберите объект на холсте или в списке слоёв, чтобы изменить его свойства. У карты есть собственные цвета среды.</p><label className="color-field"><input type="color" value={project.skyColor} onChange={event => commit(old => ({ ...old, skyColor: event.target.value }))} /><span>Небо</span><code>{project.skyColor}</code></label><label className="color-field"><input type="color" value={project.groundColor} onChange={event => commit(old => ({ ...old, groundColor: event.target.value }))} /><span>Земля</span><code>{project.groundColor}</code></label><button className="wide-button" onClick={() => addNote(null)}>✦ Заметка для карты</button></div><div className="inspector-tip"><span>✦</span><strong>Карта как план игры</strong><p>Все объекты, рисунки, заметки и игровые пометки сохраняются в переносимом архиве.</p></div></>}
      </div></aside>
    </div>
    {showFiles && <div className="modal-backdrop" onMouseDown={() => setShowFiles(false)}><div className="files-modal" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setShowFiles(false)}>×</button><span className="modal-eyebrow">ПРОЕКТ И ФАЙЛЫ</span><h2>Продолжайте где угодно</h2><p>На этом устройстве карта сохраняется автоматически. Архив переносит её вместе с рисунками, заметками и структурой объектов.</p><button onClick={() => { setShowFiles(false); exportZip(); }}>↥ Скачать архив карты <span>.mgmap.zip</span></button><button onClick={() => { setShowFiles(false); archiveInput.current?.click(); }}>↧ Открыть архив карты <span>.mgmap.zip</span></button><button onClick={() => { setShowFiles(false); pngInput.current?.click(); }}>▧ Добавить свой рисунок <span>.png</span></button><div className="modal-foot">Архив проекта можно передать мне, чтобы я использовал его при разработке уровня в Godot.</div></div></div>}
    <input ref={archiveInput} type="file" accept=".zip,.mgmap.zip,application/zip" hidden onChange={event => importZip(event.target.files?.[0])} />
    <input ref={pngInput} type="file" accept="image/png,.png" hidden onChange={event => importPng(event.target.files?.[0])} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

export default App;

