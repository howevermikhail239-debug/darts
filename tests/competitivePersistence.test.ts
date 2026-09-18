import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/application/BackupService';
import type { BackupData } from '../src/application/ports/repositories';
import { clearLocalData, IndexedDbBackupRepository, IndexedDbCompetitiveRepository } from '../src/infrastructure/persistence/IndexedDbRepositories';

const session = {
  id: 'evening',
  createdAt: '2026-09-18T18:00:00.000Z',
  title: 'Вечер',
  playerIds: ['a', 'b'],
  matchIds: ['m-1'],
} as const;
const training = {
  id: 'practice',
  playerId: 'a',
  kind: 'doubles' as const,
  startedAt: '2026-09-18T18:00:00.000Z',
  attempts: [{ target: 'D20', darts: ['D20'], success: true }],
  settings: { target: 'D20' },
};

describe('competitive persistence', () => {
  afterEach(() => clearLocalData());

  it('persists sessions and keeps training logically separate', async () => {
    const repository = new IndexedDbCompetitiveRepository();
    await repository.saveSession(session);
    await repository.saveTraining(training);
    expect(await repository.listSessions()).toEqual([session]);
    expect(await repository.listTraining('a')).toEqual([training]);
    expect(await repository.listTraining('b')).toEqual([]);
  });

  it('includes competitive stores in a v3 backup and accepts a v2 backup without them', async () => {
    const competitive = new IndexedDbCompetitiveRepository();
    const backup = new IndexedDbBackupRepository();
    await competitive.saveSession(session);
    await competitive.saveTraining(training);
    const json = await exportBackup(backup, () => '2026-09-18T19:00:00.000Z');
    expect(json).toContain('competitiveSessions');
    await clearLocalData();
    await restoreBackup(backup, json);
    expect(await competitive.listSessions()).toEqual([session]);
    expect(await competitive.listTraining('a')).toEqual([training]);

    const legacy: BackupData = { players: [], matches: [], settings: {} };
    await restoreBackup(backup, JSON.stringify({ type: 'darts-scorekeeper-backup', version: 2, exportedAt: 'old', data: legacy }));
    expect(await competitive.listSessions()).toEqual([]);
    expect(await competitive.listTraining()).toEqual([]);
  });
});
