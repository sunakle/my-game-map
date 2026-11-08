import { strToU8, unzipSync, zipSync } from 'fflate';
import type { MapProject } from './model.ts';
import { validateProject } from './model.ts';
import { loadAsset } from './storage.ts';

const MAX_ARCHIVE = 30 * 1024 * 1024;
const MAX_ENTRY = 20 * 1024 * 1024;

export function sceneOverview(project: MapProject): string {
  const lines = [
    `# ${project.name}`, '',
    `Формат: My Game Map 1 · Единица: метр · Объектов: ${project.nodes.length} · Заметок: ${project.notes.length}`, '',
    '## Объекты',
  ];
  for (const node of project.nodes) {
    lines.push(`- ${node.name} [${node.kind}], ID ${node.id}, позиция (${node.position.join(', ')}), родитель ${node.parentId ?? 'нет'}, цвет ${node.color}${node.assetId ? `, рисунок ${node.assetId}` : ''}`);
  }
  lines.push('', '## Заметки');
  for (const note of project.notes) lines.push(`- ${note.title} [${note.type}], объект ${note.targetId ?? 'вся карта'}: ${note.body.replaceAll('\n', ' ')}`);
  return lines.join('\n');
}

export async function exportArchive(project: MapProject, preview?: Blob | null): Promise<Blob> {
  validateProject(project);
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(project)),
    'overview.md': strToU8(sceneOverview(project)),
  };
  for (const asset of project.assets) {
    const blob = await loadAsset(project.id, asset.id);
    if (!blob) throw new Error(`Не найден рисунок «${asset.name}».`);
    files[`assets/${asset.id}.png`] = new Uint8Array(await blob.arrayBuffer());
  }
  if (preview) files['preview.png'] = new Uint8Array(await preview.arrayBuffer());
  if(files['project.json'].length>MAX_ENTRY)throw new Error('Описание карты превышает 20 МиБ.');
  const result=new Blob([new Uint8Array(zipSync(files,{level:6}))],{type:'application/zip'});
  if(result.size>MAX_ARCHIVE)throw new Error('Архив превышает 30 МиБ.');
  return result;
}

export async function importArchive(file: File): Promise<{ project: MapProject; images: Map<string, Blob> }> {
  if (file.size > MAX_ARCHIVE) throw new Error('Архив больше 30 МиБ.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: entry => entry.originalSize <= MAX_ENTRY && !entry.name.includes('..'),
    });
  } catch {
    throw new Error('Архив повреждён или не является ZIP.');
  }
  if (!files['project.json'] || files['project.json'].length > MAX_ENTRY) throw new Error('Нет допустимого project.json.');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(files['project.json'])); }
  catch { throw new Error('Описание карты повреждено.'); }
  if (typeof raw !== 'object' || raw === null || !('formatVersion' in raw) || raw.formatVersion !== 1) {
    throw new Error('Версия архива не поддерживается.');
  }
  let project: MapProject;
  try { project = validateProject(raw); }
  catch (error) { throw new Error(error instanceof Error ? `Карта не прошла проверку: ${error.message}` : 'Карта не прошла проверку.'); }
  const images = new Map<string, Blob>();
  for (const asset of project.assets) {
    const data = files[`assets/${asset.id}.png`];
    if (!data || data.length > 8 * 1024 * 1024 || data[0] !== 137 || data[1] !== 80 || data[2] !== 78 || data[3] !== 71) {
      throw new Error(`Повреждён или отсутствует рисунок «${asset.name}».`);
    }
    const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error(`Рисунок «${asset.name}» не открывается.`); }
    const matches = bitmap.width === asset.width && bitmap.height === asset.height;
    bitmap.close();
    if (!matches) throw new Error(`Размер рисунка «${asset.name}» не совпадает с описанием.`);
    images.set(asset.id, blob);
  }
  // Every import becomes an independent local project; object IDs and their links remain stable.
  project = { ...project, id: crypto.randomUUID(), name: `${project.name.slice(0,110)} · импорт`, updatedAt: new Date().toISOString() };
  return { project, images };
}
