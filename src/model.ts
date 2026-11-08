import { z } from 'zod';

export const kinds = ['tree', 'pine', 'bush', 'rock', 'grass', 'flower', 'water', 'road', 'bridge', 'fence', 'wall', 'tower', 'platform', 'sprite', 'group'] as const;
export type Kind = typeof kinds[number];
export type NoteType = 'idea' | 'task' | 'behavior' | 'story' | 'question';

export interface MapNode {
  id: string;
  name: string;
  kind: Kind;
  parentId: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  visible: boolean;
  locked: boolean;
  assetId?: string;
  billboard?: boolean;
  collision: boolean;
  walkable: boolean;
  spawn: boolean;
  interactive: boolean;
  transitionTo: string;
  tags: string[];
}

export interface MapNote {
  id: string;
  title: string;
  body: string;
  type: NoteType;
  targetId: string | null;
  position: [number, number, number];
  visible: boolean;
}

export interface AssetMeta {
  id: string;
  name: string;
  mime: 'image/png';
  width: number;
  height: number;
}

export interface MapProject {
  formatVersion: 1;
  id: string;
  name: string;
  updatedAt: string;
  unit: 'meter';
  nodes: MapNode[];
  notes: MapNote[];
  assets: AssetMeta[];
  camera: { mode: 'perspective' | 'orthographic'; position: [number, number, number]; target: [number, number, number] };
  snap: boolean;
  grid: boolean;
  skyColor: string;
  groundColor: string;
}

const vec = z.tuple([z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nodeSchema = z.object({
  id: z.uuid(), name: z.string().max(120), kind: z.enum(kinds), parentId: z.uuid().nullable(),
  position: vec, rotation: vec, scale: vec, color: hex, visible: z.boolean(), locked: z.boolean(),
  assetId: z.uuid().optional(), billboard: z.boolean().optional(), collision: z.boolean(),
  walkable: z.boolean(), spawn: z.boolean(), interactive: z.boolean(), transitionTo: z.string().max(120),
  tags: z.array(z.string().max(60)).max(20),
});
const noteSchema = z.object({
  id: z.uuid(), title: z.string().max(120), body: z.string().max(4000),
  type: z.enum(['idea', 'task', 'behavior', 'story', 'question']), targetId: z.uuid().nullable(),
  position: vec, visible: z.boolean(),
});
export const projectSchema = z.object({
  formatVersion: z.literal(1), id: z.uuid(), name: z.string().min(1).max(120), updatedAt: z.iso.datetime(),
  unit: z.literal('meter'), nodes: z.array(nodeSchema).max(2000), notes: z.array(noteSchema).max(1000),
  assets: z.array(z.object({ id: z.uuid(), name: z.string().max(120), mime: z.literal('image/png'), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) })).max(100),
  camera: z.object({ mode: z.enum(['perspective', 'orthographic']), position: vec, target: vec }),
  snap: z.boolean(), grid: z.boolean(), skyColor: hex, groundColor: hex,
});

export const names: Record<Kind, string> = {
  tree: 'Лиственное дерево', pine: 'Сосна', bush: 'Куст', rock: 'Камень', grass: 'Пучок травы',
  flower: 'Цветок', water: 'Вода', road: 'Дорожка', bridge: 'Мост', fence: 'Забор',
  wall: 'Стена', tower: 'Башня', platform: 'Площадка', sprite: 'Мой рисунок', group: 'Группа',
};
export const defaultColors: Record<Kind, string> = {
  tree: '#78946b', pine: '#5d8370', bush: '#91a56b', rock: '#9ba5a2', grass: '#98ad65',
  flower: '#efa16f', water: '#6eabb4', road: '#aa947b', bridge: '#a47e62', fence: '#a17c5e',
  wall: '#9b9d94', tower: '#a7a79c', platform: '#83966f', sprite: '#ffffff', group: '#d7cba9',
};

export function newProject(name = 'Новая карта'): MapProject {
  return {
    formatVersion: 1, id: crypto.randomUUID(), name, updatedAt: new Date().toISOString(), unit: 'meter',
    nodes: [], notes: [], assets: [],
    camera: { mode: 'perspective', position: [18, 16, 18], target: [0, 0, 0] },
    snap: true, grid: true, skyColor: '#b8cbd1', groundColor: '#78916f',
  };
}

export function newNode(kind: Kind, position: [number, number, number], extra: Partial<MapNode> = {}): MapNode {
  return {
    id: crypto.randomUUID(), name: names[kind], kind, parentId: null, position,
    rotation: [0, 0, 0], scale: [1, 1, 1], color: defaultColors[kind],
    visible: true, locked: false, billboard: ['tree', 'pine', 'bush'].includes(kind), collision: ['tree', 'pine', 'bush', 'rock', 'bridge', 'fence', 'wall', 'tower'].includes(kind),
    walkable: ['road', 'bridge', 'platform'].includes(kind), spawn: false, interactive: false,
    transitionTo: '', tags: [], ...extra,
  };
}

export function validateProject(input: unknown): MapProject {
  const project = projectSchema.parse(input) as MapProject;
  const ids = new Set(project.nodes.map(node => node.id));
  if (ids.size !== project.nodes.length) throw new Error('В карте повторяются идентификаторы объектов.');
  const assetIds = new Set(project.assets.map(asset => asset.id));
  for (const node of project.nodes) {
    if (node.parentId && (!ids.has(node.parentId) || node.parentId === node.id)) throw new Error('Повреждена иерархия объектов.');
    if (node.assetId && !assetIds.has(node.assetId)) throw new Error('Отсутствует изображение объекта.');
  }
  for (const node of project.nodes) {
    const seen = new Set<string>();
    let current: MapNode | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.id)) throw new Error('В группах найден цикл.');
      seen.add(current.id);
      current = project.nodes.find(other => other.id === current?.parentId);
    }
  }
  for (const note of project.notes) if (note.targetId && !ids.has(note.targetId)) throw new Error('Заметка ссылается на отсутствующий объект.');
  return project;
}

export function descendants(nodes: MapNode[], id: string): string[] {
  const result = [id];
  for (let i = 0; i < result.length; i++) for (const node of nodes) if (node.parentId === result[i]) result.push(node.id);
  return result;
}
