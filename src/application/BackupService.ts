import type { BackupData, BackupRepository } from './ports/repositories';

export const BACKUP_TYPE = 'darts-scorekeeper-backup';
/** Версия 2 добавила секции компании (companies / companyPlayers / companyMatches) и lastSetups. */
export const BACKUP_VERSION = 2;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2];
export type BackupEnvelope = Readonly<{
  type: typeof BACKUP_TYPE;
  version: number;
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
  if (typeof value.version !== 'number' || !SUPPORTED_BACKUP_VERSIONS.includes(value.version))
    throw new Error('Версия резервной копии не поддерживается.');
  // Копия версии 1 просто не содержит секций компании — восстанавливается как есть.
  await repository.replaceAll(value.data as BackupData);
}
