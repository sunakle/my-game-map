import { openDB } from 'idb';
import type { MapProject } from './model.ts';

let connection: ReturnType<typeof openDB> | undefined;
const database = () => connection ??= openDB('my-game-map-v1', 1, {
  upgrade(db) {
    db.createObjectStore('projects', { keyPath: 'id' });
    db.createObjectStore('assets');
  },
});

export async function listProjects(): Promise<MapProject[]> {
  const rows = await (await database()).getAll('projects') as MapProject[];
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<MapProject | undefined> {
  return (await database()).get('projects', id) as Promise<MapProject | undefined>;
}

export async function saveProject(project: MapProject): Promise<void> {
  const tx = (await database()).transaction('projects', 'readwrite');
  await tx.store.put(project);
  await tx.done;
}

export async function deleteProject(project: MapProject): Promise<void> {
  const tx = (await database()).transaction(['projects', 'assets'], 'readwrite');
  await tx.objectStore('projects').delete(project.id);
  for (const asset of project.assets) await tx.objectStore('assets').delete(`${project.id}:${asset.id}`);
  await tx.done;
}

export async function saveAsset(projectId: string, assetId: string, blob: Blob): Promise<void> {
  const tx = (await database()).transaction('assets', 'readwrite');
  await tx.store.put(blob, `${projectId}:${assetId}`);
  await tx.done;
}

export async function loadAsset(projectId: string, assetId: string): Promise<Blob | undefined> {
  return (await database()).get('assets', `${projectId}:${assetId}`) as Promise<Blob | undefined>;
}

export async function storeImportedProject(project: MapProject, images: Map<string, Blob>): Promise<void> {
  const tx = (await database()).transaction(['projects', 'assets'], 'readwrite');
  await tx.objectStore('projects').put(project);
  for (const [id, blob] of images) await tx.objectStore('assets').put(blob, `${project.id}:${id}`);
  await tx.done;
}
