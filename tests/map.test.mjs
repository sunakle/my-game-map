import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newNode, validateProject, descendants } from '../src/model.ts';
import { exportArchive, importArchive, sceneOverview } from '../src/archive.ts';

test('a map keeps stable object and note links through an archive', async () => {
  const project = newProject('Лесная тропа');
  const group = newNode('group', [2, 0, 3]);
  const tree = newNode('tree', [2, 0, 3], { parentId: group.id });
  project.nodes.push(group, tree);
  project.notes.push({ id: crypto.randomUUID(), title: 'Начало', body: 'Здесь начинается уровень', type: 'story', targetId: tree.id, position: [0, 0, 0], visible: true });
  assert.deepEqual(descendants(project.nodes, group.id), [group.id, tree.id]);
  assert.match(sceneOverview(project), /Здесь начинается уровень/);
  const archive = await exportArchive(project);
  const result = await importArchive(new File([archive], 'forest.mgmap.zip'));
  assert.notEqual(result.project.id, project.id);
  assert.deepEqual(result.project.nodes, project.nodes);
  assert.equal(result.project.notes[0].targetId, tree.id);
  assert.equal(result.images.size, 0);
});

test('damaged maps and unsupported format versions are rejected', async () => {
  const project = newProject();
  project.nodes.push(newNode('rock', [0, 0, 0]));
  const duplicate = structuredClone(project);
  duplicate.nodes.push({ ...duplicate.nodes[0] });
  assert.throws(() => validateProject(duplicate), /повторяются/);
  const broken = new File([new Uint8Array([1, 2, 3, 4])], 'broken.mgmap.zip');
  await assert.rejects(() => importArchive(broken), /повреждён/);
  const future = { ...project, formatVersion: 2 };
  assert.throws(() => validateProject(future));
});
