import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbBackupRepository,
  IndexedDbLastSetupRepository,
  IndexedDbMatchRepository,
  IndexedDbPlayerRepository,
  IndexedDbSharedRepository,
  LocalSettingsRepository,
  clearLocalData,
} from '../src/infrastructure/persistence/IndexedDbRepositories';
import { BACKUP_TYPE, BACKUP_VERSION, exportBackup, restoreBackup } from '../src/application/BackupService';
import { createMatch } from '../src/domain/match/createMatch';
import { emptyDraft } from '../src/domain/match/VisitDraft';
import type { Match } from '../src/domain/match/models';

const token = 'company-token';
const now = () => '2026-09-11T12:00:00.000Z';
const x01 = (id: string, createdAt = '2026-09-01T10:00:00.000Z') =>
  createMatch(id, ['a', 'b'], { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, createdAt);
const finished = (id: string): Match => ({
  ...x01(id),
  status: 'completed',
  completedAt: '2026-09-01T11:00:00.000Z',
  winnerId: 'a',
});
const template = {
  participants: [{ name: 'Анна' }, { name: 'Борис' }],
  setup: {
    mode: 'x01' as const,
    startingScore: 501 as const,
    outRule: 'straight' as const,
    format: { kind: 'unlimited' as const },
    startingPlayerIndex: 0,
  },
};

async function seed(): Promise<void> {
  const players = new IndexedDbPlayerRepository();
  const matches = new IndexedDbMatchRepository();
  const shared = new IndexedDbSharedRepository();
  await players.save({ id: 'a', name: 'Анна', createdAt: '2026-08-01T10:00:00.000Z' });
  await new LocalSettingsRepository().save({ theme: 'dark' });
  await new IndexedDbLastSetupRepository().save('local', template);
  await shared.saveCompany({ token, name: 'Лига', createdAt: '2026-08-02T10:00:00.000Z' });
  await shared.savePlayers(token, [{ id: 'p1', name: 'Миша', createdAt: '2026-08-03T10:00:00.000Z' }]);
  await shared.mergeRemote(token, [finished('company-synced')]);
  await shared.setState(token, 'company-synced', 'pending');
  await matches.saveActive({
    current: x01('active'),
    draft: { playerId: 'a', draft: emptyDraft() },
    companyToken: token,
  });
  await matches.archiveAndClearActive(finished('archived'));
  await matches.saveActive({
    current: x01('still-active'),
    draft: { playerId: 'a', draft: emptyDraft() },
    companyToken: token,
  });
}

describe('backup with company data', () => {
  afterEach(() => clearLocalData());

  it('exports companies, their players, the offline queue, lastSetup and the active companyToken', async () => {
    await seed();
    const json = await exportBackup(new IndexedDbBackupRepository(), now);
    const envelope = JSON.parse(json) as { type: string; version: number; data: Record<string, unknown> };

    expect(envelope.type).toBe(BACKUP_TYPE);
    expect(envelope.version).toBe(2);
    expect(envelope.data.companies).toEqual([{ token, name: 'Лига', createdAt: '2026-08-02T10:00:00.000Z' }]);
    expect(envelope.data.companyPlayers).toMatchObject([{ token, players: [{ id: 'p1' }] }]);
    expect(
      (envelope.data.companyMatches as { matchId: string; state: string }[]).map((row) => row.matchId).sort(),
    ).toEqual(['archived', 'company-synced']);
    expect(envelope.data.lastSetups).toMatchObject([{ context: 'local' }]);
    expect(envelope.data.active).toMatchObject({ companyToken: token, current: { id: 'still-active' } });
  });

  it('restores everything, including the company token, onto a clean database', async () => {
    await seed();
    const json = await exportBackup(new IndexedDbBackupRepository(), now);
    await clearLocalData();

    await restoreBackup(new IndexedDbBackupRepository(), json);

    const shared = new IndexedDbSharedRepository();
    const matches = new IndexedDbMatchRepository();
    expect(await shared.companies()).toEqual([{ token, name: 'Лига', createdAt: '2026-08-02T10:00:00.000Z' }]);
    expect((await shared.players(token)).map((player) => player.id)).toEqual(['p1']);
    const cached = await shared.matches(token);
    expect(cached.map((item) => item.matchId).sort()).toEqual(['archived', 'company-synced']);
    expect(cached.every((item) => item.state === 'pending')).toBe(true);
    expect((await matches.loadActive())?.companyToken).toBe(token);
    expect((await matches.listHistory()).map((match) => match.id)).toEqual(['archived']);
    expect(await new IndexedDbLastSetupRepository().load('local')).toEqual(template);
    expect(await new LocalSettingsRepository().load()).toEqual({ theme: 'dark' });
  });

  it("wipes the previous owner's company data instead of mixing it with the restored copy", async () => {
    await seed();
    const json = await exportBackup(new IndexedDbBackupRepository(), now);
    await clearLocalData();

    // «Чужое» устройство со своей компанией и своим шаблоном настройки.
    const shared = new IndexedDbSharedRepository();
    await shared.saveCompany({ token: 'stranger', name: 'Чужие', createdAt: '2026-01-01T10:00:00.000Z' });
    await shared.savePlayers('stranger', [{ id: 'x', name: 'Икс', createdAt: '2026-01-01T10:00:00.000Z' }]);
    await shared.mergeRemote('stranger', [finished('stranger-match')]);
    await new IndexedDbLastSetupRepository().save('stranger', template);

    await restoreBackup(new IndexedDbBackupRepository(), json);

    expect((await shared.companies()).map((company) => company.token)).toEqual([token]);
    expect(await shared.players('stranger')).toEqual([]);
    expect(await shared.matches('stranger')).toEqual([]);
    expect(await new IndexedDbLastSetupRepository().load('stranger')).toBeUndefined();
  });

  it('still restores a version 1 backup that knows nothing about companies', async () => {
    const legacy = JSON.stringify({
      type: BACKUP_TYPE,
      version: 1,
      exportedAt: now(),
      data: {
        players: [{ id: 'a', name: 'Анна', createdAt: '2026-08-01T10:00:00.000Z' }],
        matches: [finished('old-history')],
        settings: { theme: 'light' },
        active: { current: x01('old-active'), draft: { playerId: 'a', draft: emptyDraft() } },
      },
    });

    await restoreBackup(new IndexedDbBackupRepository(), legacy);

    const matches = new IndexedDbMatchRepository();
    expect((await matches.listHistory()).map((match) => match.id)).toEqual(['old-history']);
    expect((await matches.loadActive())?.current.id).toBe('old-active');
    expect(await new IndexedDbSharedRepository().companies()).toEqual([]);
    expect(await new LocalSettingsRepository().load()).toEqual({ theme: 'light' });
  });

  it('rejects an unknown backup version', async () => {
    const future = JSON.stringify({
      type: BACKUP_TYPE,
      version: BACKUP_VERSION + 1,
      exportedAt: now(),
      data: { players: [], matches: [], settings: {} },
    });
    await expect(restoreBackup(new IndexedDbBackupRepository(), future)).rejects.toThrow('не поддерживается');
  });
});
