import type { BackupData, BackupRepository } from './ports/repositories';

export const BACKUP_TYPE = 'darts-scorekeeper-backup';
export const BACKUP_VERSION = 1;
export type BackupEnvelope = Readonly<{
  type: typeof BACKUP_TYPE;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupData;
}>;

export async function exportBackup(repository: BackupRepository, now: () => string): Promise<string> {
  const data = await repository.readAll();
  return JSON.stringify({ type: BACKUP_TYPE, version: BACKUP_VERSION, exportedAt: now(), data }, null, 2);
}

export async function restoreBackup(repository: BackupRepository, json: string): Promise<void> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Файл не является корректным JSON.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Некорректный формат резервной копии.');
  const value = parsed as Record<string, unknown>;
  if (value.type !== BACKUP_TYPE) throw new Error('Это не резервная копия Dart Scorekeeper.');
  if (value.version !== BACKUP_VERSION) throw new Error('Версия резервной копии не поддерживается.');
  await repository.replaceAll(value.data as BackupData);
}
