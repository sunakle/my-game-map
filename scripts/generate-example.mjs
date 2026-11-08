import { mkdir, writeFile } from 'node:fs/promises';
import { newProject, newNode } from '../src/model.ts';
import { exportArchive } from '../src/archive.ts';

const project = newProject('Лесная тропа — пример');
const nature = newNode('group', [-2, 0, 0], { name: 'Лес' });
const path = newNode('group', [0, 0, 0], { name: 'Дорожка и переход' });
project.nodes = [
  nature,
  path,
  newNode('tree', [-4, 0, -1], { parentId: nature.id }),
  newNode('pine', [-5, 0, 3], { parentId: nature.id }),
  newNode('tree', [4, 0, 2], { parentId: nature.id }),
  newNode('bush', [-3, 0, 2], { parentId: nature.id }),
  newNode('bush', [3, 0, -2], { parentId: nature.id }),
  newNode('rock', [3, 0, 3], { parentId: nature.id }),
  newNode('road', [0, 0, 0], { parentId: path.id, scale: [1, 1, 1.7] }),
  newNode('road', [0, 0, -4], { parentId: path.id, scale: [1, 1, 1.7] }),
  newNode('bridge', [0, 0, 5], { parentId: path.id }),
  newNode('water', [0, 0, 5], { scale: [2.5, 1, 1.5] }),
  newNode('flower', [-2, 0, -3]),
];
const start = project.nodes.find(node => node.kind === 'road');
project.notes = [{ id: crypto.randomUUID(), title: 'Начало пути', body: 'Пример заметки: здесь игрок впервые видит лес и идёт к мосту.', type: 'story', targetId: start.id, position: [0, 0, 0], visible: true }];
await mkdir('examples', { recursive: true });
await writeFile('examples/forest-path.mgmap.zip', new Uint8Array(await (await exportArchive(project)).arrayBuffer()));
console.log('examples/forest-path.mgmap.zip');
