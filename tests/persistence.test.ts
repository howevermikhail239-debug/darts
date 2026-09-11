import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { isActiveMatchConflict } from '../src/application/ports/repositories';
import {
  ActiveMatchConflictError,
  IndexedDbMatchRepository,
  IndexedDbPlayerRepository,
  IndexedDbSharedRepository,
  clearLocalData,
} from '../src/infrastructure/persistence/IndexedDbRepositories';
import { createMatch } from '../src/domain/match/createMatch';
import { emptyDraft } from '../src/domain/match/VisitDraft';
import { numberThrow } from '../src/domain/darts/DartThrow';
import type { Match } from '../src/domain/match/models';

const DB_NAME = 'dart-scorekeeper';

function openRaw(version?: number, upgrade?: (database: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
/** Гарантирует, что база создана приложением (актуальная схема со всеми стор-ами). */
const ensureSchema = () => new IndexedDbPlayerRepository().list();
async function putRaw(store: string, value: unknown, key?: string): Promise<void> {
  await ensureSchema();
  const database = await openRaw();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(store, 'readwrite');
      if (key === undefined) transaction.objectStore(store).put(value as never);
      else transaction.objectStore(store).put(value as never, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
const putRawActive = (value: unknown) => putRaw('meta', value, 'activeMatch');
const putRawHistory = (value: unknown) => putRaw('matches', value);
const deleteRawDatabase = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

function validVisit(match: ReturnType<typeof createMatch>) {
  return {
    id: 'visit-1',
    matchId: match.id,
    playerId: 'a',
    visitIndex: 0,
    darts: [numberThrow(20, 1)],
    physicalDartsUsed: 1,
    rawScore: 20,
    awardedScore: 20,
    before: { scores: { a: 501, b: 501 }, currentPlayerIndex: 0 },
    after: { scores: { a: 481, b: 501 }, currentPlayerIndex: 1 },
    result: 'scored',
    timestamp: '2026-09-08T12:00:00.000Z',
  };
}
const x01 = (id: string, createdAt = new Date().toISOString()) =>
  createMatch(id, ['a', 'b'], { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, createdAt);
const finished = (match: Match, completedAt = '2026-09-08T12:00:00.000Z'): Match => ({
  ...match,
  status: 'completed',
  completedAt,
  winnerId: 'a',
});

describe('IndexedDB repository', () => {
  afterEach(() => clearLocalData());
  it('persists current and previous checkpoint', async () => {
    const repo = new IndexedDbMatchRepository(),
      m = x01('m');
    const draft = { playerId: 'a', draft: emptyDraft() };
    await repo.saveActive({ current: m, previous: m, draft });
    expect(await repo.loadActive()).toMatchObject({ current: m, previous: m, draft });
  });
  it('migrates an old X01 save without startingScore or outRule to 501 straight-out', async () => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('legacy-x01');
    if (match.state.kind !== 'x01') throw new Error('test setup');
    const legacyState = Object.fromEntries(
      Object.entries(match.state).filter(([key]) => key !== 'startingScore' && key !== 'outRule'),
    );
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({
      schemaVersion: 2,
      current: { ...match, state: legacyState },
      draft: { playerId: 'a', draft: emptyDraft() },
    });
    expect((await repo.loadActive())?.current.state).toMatchObject({
      kind: 'x01',
      startingScore: 501,
      outRule: 'straight',
    });
  });
  it('rejects the obsolete X01 leg format instead of silently changing its rules', async () => {
    const repo = new IndexedDbMatchRepository();
    const valid = x01('old');
    const obsolete = {
      ...valid,
      state: {
        kind: 'x01',
        targetLegWins: 1,
        remaining: { a: 501, b: 501 },
        legsWon: { a: 0, b: 0 },
        currentLeg: 1,
        legStarterIndex: 0,
      },
    };
    const legacy = await openRaw(1, (database) => {
      database.createObjectStore('matches', { keyPath: 'id' });
      database.createObjectStore('players', { keyPath: 'id' });
      database.createObjectStore('meta');
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = legacy.transaction('meta', 'readwrite');
      transaction.objectStore('meta').put({ schemaVersion: 1, current: obsolete }, 'activeMatch');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();
    await expect(repo.loadActive()).rejects.toThrow('Сохранённый матч повреждён');
  });
  it('persists a player-bound draft with physical darts', async () => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('draft');
    const draft = { playerId: 'a', draft: { darts: [numberThrow(20, 3), numberThrow(10, 1)] } };
    await repo.saveActive({ current: match, draft });
    expect(await repo.loadActive()).toMatchObject({ current: match, draft });
  });
  it.each([
    ['invalid dart', { playerId: 'a', draft: { darts: [{ kind: 'number', segment: 21, multiplier: 3 }] } }],
    ['wrong player', { playerId: 'b', draft: { darts: [numberThrow(20, 1)] } }],
    [
      'too many darts',
      { playerId: 'a', draft: { darts: [numberThrow(1, 1), numberThrow(2, 1), numberThrow(3, 1), numberThrow(4, 1)] } },
    ],
  ])('keeps a valid match and discards a corrupt draft: %s', async (_label, corruptDraft) => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('recover');
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 2, current: match, draft: corruptDraft });
    expect(await repo.loadActive()).toMatchObject({
      current: match,
      draft: { playerId: 'a', draft: emptyDraft() },
      draftRecovery: 'discarded_corrupt',
    });
  });
  it('does not offer to wipe anything when the record comes from a newer app version', async () => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('future');
    const historical = finished(x01('kept-history', '2026-09-01T10:00:00.000Z'));
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawHistory(historical);
    await putRawActive({ schemaVersion: 99, current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await expect(repo.loadActive()).resolves.toBeUndefined();
    expect(repo.activeMatchIssue()).toBe('future_version');
    expect((await repo.listHistory()).map((item) => item.id)).toEqual(['kept-history']);
  });
  it('still reports a structurally broken envelope as corrupt', async () => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('broken-version');
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({ schemaVersion: 0, current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await expect(repo.loadActive()).rejects.toThrow('неподдерживаемую версию');
  });
  it.each([
    [
      'a string multiplier',
      (visit: ReturnType<typeof validVisit>) => ({
        ...visit,
        darts: [{ kind: 'number', segment: 20, multiplier: '3' }],
      }),
    ],
    ['a negative visit index', (visit: ReturnType<typeof validVisit>) => ({ ...visit, visitIndex: -1 })],
    [
      'a mismatched physical-dart count',
      (visit: ReturnType<typeof validVisit>) => ({ ...visit, physicalDartsUsed: 2 }),
    ],
    ['a mismatched raw score', (visit: ReturnType<typeof validVisit>) => ({ ...visit, rawScore: 60 })],
    ['an unknown result', (visit: ReturnType<typeof validVisit>) => ({ ...visit, result: 'teleported' })],
    ['a foreign match id', (visit: ReturnType<typeof validVisit>) => ({ ...visit, matchId: 'other-match' })],
    ['a player outside the match', (visit: ReturnType<typeof validVisit>) => ({ ...visit, playerId: 'outsider' })],
  ])('rejects an active match with %s', async (_label, corrupt) => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('strict-visit');
    const visit = corrupt(validVisit(match));
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({
      schemaVersion: 2,
      current: { ...match, confirmedVisits: [visit] },
      draft: { playerId: 'a', draft: emptyDraft() },
    });
    await expect(repo.loadActive()).rejects.toThrow('Сохранённый матч повреждён');
  });
  it('rejects an invalid mode state while accepting only the discriminated state kind', async () => {
    const repo = new IndexedDbMatchRepository();
    const match = x01('strict-state');
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawActive({
      schemaVersion: 2,
      current: { ...match, state: { ...match.state, kind: 'unknown' } },
      draft: { playerId: 'a', draft: emptyDraft() },
    });
    await expect(repo.loadActive()).rejects.toThrow('Сохранённый матч повреждён');
  });
  it('skips one corrupt history record without hiding valid history and counts it', async () => {
    const repo = new IndexedDbMatchRepository();
    const valid = finished(x01('valid-history'));
    await repo.saveActive({ current: valid, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawHistory(valid);
    await putRawHistory({ ...valid, id: 'broken-history', state: { ...valid.state, kind: 'unknown' } });
    expect((await repo.listHistory()).map((match) => match.id)).toEqual(['valid-history']);
    expect(await repo.readHistory()).toMatchObject({ skipped: 1 });
  });
  it('reads history newest first and honours an optional limit', async () => {
    const repo = new IndexedDbMatchRepository();
    await putRawHistory(finished(x01('older', '2026-09-01T10:00:00.000Z')));
    await putRawHistory(finished(x01('newer', '2026-09-05T10:00:00.000Z')));
    await putRawHistory(finished(x01('newest', '2026-09-09T10:00:00.000Z')));
    expect((await repo.listHistory()).map((match) => match.id)).toEqual(['newest', 'newer', 'older']);
    expect((await repo.listHistory(2)).map((match) => match.id)).toEqual(['newest', 'newer']);
  });
  it('deleting a profile never mutates immutable historical participants', async () => {
    const matches = new IndexedDbMatchRepository();
    const players = new IndexedDbPlayerRepository();
    const player = { id: 'a', name: 'Анна', createdAt: '2026-09-11T12:00:00.000Z' };
    const historical = createMatch(
      'profile-history',
      ['a', 'b'],
      { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
      player.createdAt,
    );
    await players.save(player);
    await putRawHistory(historical);
    await players.delete(player.id);
    expect((await matches.listHistory())[0]?.players).toEqual(['a', 'b']);
    expect((await matches.listHistory())[0]?.participantNames.a).toBe('Игрок 1');
  });
  it('restores a completed Fixed Visits match whose regulation phase has no artificial round', async () => {
    const repo = new IndexedDbMatchRepository();
    const base = createMatch(
      'fixed-history',
      ['a', 'b'],
      { mode: 'fixed_visits', visitsPerPlayer: 1, startingPlayerIndex: 0 },
      new Date().toISOString(),
    );
    const completed = { ...base, status: 'completed' as const, completedAt: '2026-09-08T12:00:00.000Z', winnerId: 'a' };
    await repo.saveActive({ current: base, draft: { playerId: 'a', draft: emptyDraft() } });
    await putRawHistory(completed);
    expect(await repo.listHistory()).toEqual([completed]);
  });

  it('rejects a concurrent write from a second tab instead of overwriting its progress', async () => {
    const tabA = new IndexedDbMatchRepository();
    const tabB = new IndexedDbMatchRepository();
    const match = x01('multitab');
    const draft = { playerId: 'a', draft: emptyDraft() };
    await tabA.saveActive({ current: match, draft });
    const loadedA = await tabA.loadActive();
    const loadedB = await tabB.loadActive();
    expect(loadedA?.revision).toBe(loadedB?.revision);

    const advanced = { ...match, currentPlayerIndex: 1 };
    await tabB.saveActive({ current: advanced, draft: { playerId: 'b', draft: emptyDraft() } });

    const conflict = await tabA.saveActive({ current: match, draft }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(conflict).toBeInstanceOf(ActiveMatchConflictError);
    // Презентационный слой распознаёт конфликт через порт, не импортируя инфраструктуру.
    expect(isActiveMatchConflict(conflict)).toBe(true);
    expect((await tabB.loadActive())?.current.currentPlayerIndex).toBe(1);
  });
  it("recovers after a reload once the conflicting tab's state is re-read", async () => {
    const tabA = new IndexedDbMatchRepository();
    const tabB = new IndexedDbMatchRepository();
    const match = x01('recovered');
    await tabA.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await tabB.loadActive();
    await tabB.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } });
    await expect(tabA.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } })).rejects.toThrow(
      'другой вкладке',
    );
    await tabA.loadActive();
    await expect(
      tabA.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() } }),
    ).resolves.toBeUndefined();
  });
  it('does not poison the connection after a failed open', async () => {
    // Препятствие: база более высокой версии, открытая другой вкладкой.
    const obstacle = await openRaw(9, (database) => database.createObjectStore('meta'));
    const repo = new IndexedDbMatchRepository();
    await expect(repo.listHistory()).rejects.toThrow();
    obstacle.close();
    await deleteRawDatabase();
    await expect(repo.listHistory()).resolves.toEqual([]);
  });

  it('keeps a deleted company match deleted even when it was still pending', async () => {
    const shared = new IndexedDbSharedRepository();
    const token = 'company-token';
    const match = finished(x01('ghost'));
    await shared.saveCompany({ token, name: 'Лига', createdAt: '2026-09-01T10:00:00.000Z' });
    await shared.mergeRemote(token, [match]);
    await shared.setState(token, match.id, 'pending');
    expect(await shared.matches(token)).toHaveLength(1);

    await shared.forgetMatch(token, match.id);
    expect(await shared.matches(token)).toEqual([]);
    expect(await shared.deletedMatchIds(token)).toEqual([match.id]);

    // Сервер ещё отдаёт удалённый матч — воскрешать его нельзя.
    await shared.mergeRemote(token, [match]);
    expect(await shared.matches(token)).toEqual([]);

    // Сервер подтвердил удаление — надгробие убирается.
    await shared.mergeRemote(token, []);
    expect(await shared.deletedMatchIds(token)).toEqual([]);
  });
  it('stores company matches in their own store, indexed by token', async () => {
    const shared = new IndexedDbSharedRepository();
    const mine = finished(x01('mine'));
    const other = finished(x01('other'));
    await shared.mergeRemote('token-a', [mine]);
    await shared.mergeRemote('token-b', [other]);
    expect((await shared.matches('token-a')).map((item) => item.matchId)).toEqual(['mine']);
    expect((await shared.matches('token-b')).map((item) => item.matchId)).toEqual(['other']);
  });
  it('reads the upload queue by index without loading synced history', async () => {
    const shared = new IndexedDbSharedRepository();
    const token = 'queue';
    await shared.mergeRemote(token, [finished(x01('synced')), finished(x01('pending')), finished(x01('rejected'))]);
    await shared.setState(token, 'pending', 'pending');
    await shared.setState(token, 'rejected', 'rejected', { reason: 'Матч слишком большой' });
    expect((await shared.pendingMatches(token)).map((item) => item.matchId)).toEqual(['pending']);

    await shared.setState(token, 'pending', 'error', { attempts: 2, failedAt: '2026-09-11T12:00:00.000Z' });
    expect(await shared.pendingMatches(token)).toMatchObject([{ matchId: 'pending', state: 'error', attempts: 2 }]);
    expect((await shared.matches(token)).find((item) => item.matchId === 'rejected')?.reason).toBe(
      'Матч слишком большой',
    );
  });
  it('applies concurrent player mutations inside one transaction without losing writes', async () => {
    const shared = new IndexedDbSharedRepository();
    const token = 'race';
    const created = (id: string) => ({ id, name: id, createdAt: '2026-09-01T10:00:00.000Z' });
    await shared.savePlayers(token, [created('first')]);
    await Promise.all([
      shared.updatePlayers(token, (current) => [...current, created('second')]),
      shared.updatePlayers(token, (current) => [...current, created('third')]),
    ]);
    expect((await shared.players(token)).map((player) => player.id).sort()).toEqual(['first', 'second', 'third']);
  });
  it('archives a company match into the company store instead of losing its token', async () => {
    const repo = new IndexedDbMatchRepository();
    const shared = new IndexedDbSharedRepository();
    const match = x01('company-match');
    await repo.saveActive({ current: match, draft: { playerId: 'a', draft: emptyDraft() }, companyToken: 'token-c' });
    await repo.archiveAndClearActive(finished(match));
    expect((await shared.matches('token-c')).map((item) => ({ id: item.matchId, state: item.state }))).toEqual([
      { id: 'company-match', state: 'pending' },
    ]);
    expect((await repo.listHistory()).map((item) => item.id)).toEqual(['company-match']);
    expect(await repo.loadActive()).toBeUndefined();
  });
});
