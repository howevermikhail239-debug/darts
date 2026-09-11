import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLastSetupTemplate, lastSetupContext, restoreLastSetupParticipants } from '../src/application/LastSetup';
import { prepareResultShare } from '../src/application/PrepareResultShare';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match, Player, Visit } from '../src/domain/match/models';
import { recentForm, summarizeToday } from '../src/domain/statistics/todaySummary';
import { headToHead, statisticsForPlayerHistory, trendForPlayer } from '../src/domain/statistics/StatisticsCalculator';
import { deliverResultFile } from '../src/infrastructure/share/BrowserResultShare';
import { clearLocalData, IndexedDbLastSetupRepository } from '../src/infrastructure/persistence/IndexedDbRepositories';

const at = '2026-09-10T12:00:00.000Z';
const player = (id: string, name: string): Player => ({ id, name, createdAt: at });
function completed(
  id: string,
  winnerId: string | undefined,
  names: Record<string, string> = { a: 'Миша', b: 'Саша' },
  status: Match['status'] = 'completed',
): Match {
  const ids = Object.keys(names);
  const base = createMatch(id, ids, { mode: 'fixed_visits', visitsPerPlayer: 1, startingPlayerIndex: 0 }, at, names);
  const visits: Visit[] = ids.map((playerId, index) => ({
    id: `${id}-v${index}`,
    matchId: id,
    playerId,
    visitIndex: index,
    inputKind: 'aggregate',
    aggregateScore: index ? 40 : 60,
    physicalDartsUsed: 3,
    rawScore: index ? 40 : 60,
    awardedScore: index ? 40 : 60,
    before: { scores: Object.fromEntries(ids.map((item) => [item, 0])), currentPlayerIndex: index },
    after: { scores: Object.fromEntries(ids.map((item) => [item, 0])), currentPlayerIndex: (index + 1) % ids.length },
    result: winnerId === playerId ? 'match_won' : 'scored',
    timestamp: at,
  }));
  return { ...base, status, completedAt: at, confirmedVisits: visits, ...(winnerId ? { winnerId } : {}) };
}

describe('Stage 4.6 Last Setup', () => {
  afterEach(() => clearLocalData());
  it('preserves stable and temporary participants plus every real match option', () => {
    const template = createLastSetupTemplate([{ name: 'Миша', playerId: 'p1' }, { name: 'Дима' }], {
      mode: 'x01',
      startingScore: 701,
      outRule: 'double',
      format: { kind: 'limited', visitsPerPlayer: 9 },
      startingPlayerIndex: 1,
    });
    expect(template).toEqual({
      participants: [{ name: 'Миша', playerId: 'p1' }, { name: 'Дима' }],
      setup: {
        mode: 'x01',
        startingScore: 701,
        outRule: 'double',
        format: { kind: 'limited', visitsPerPlayer: 9 },
        startingPlayerIndex: 1,
      },
    });
    expect(restoreLastSetupParticipants(template, [player('p1', 'Михаил')])).toEqual([
      { name: 'Михаил', playerId: 'p1' },
      { name: 'Дима' },
    ]);
  });

  it('marks a missing profile by id and never substitutes a same-named player', () => {
    const template = createLastSetupTemplate([{ name: 'Миша', playerId: 'gone' }, { name: 'Гость' }], {
      mode: 'fixed_visits',
      visitsPerPlayer: 5,
      startingPlayerIndex: 0,
    });
    expect(restoreLastSetupParticipants(template, [player('replacement', 'Миша')])?.[0]).toEqual({
      name: 'Миша',
      missingPlayerId: 'gone',
    });
  });

  it('isolates local and each company by stable token', async () => {
    const repository = new IndexedDbLastSetupRepository();
    const local = createLastSetupTemplate([{ name: 'Локальный 1' }, { name: 'Локальный 2' }], {
      mode: 'x01',
      startingScore: 301,
      outRule: 'straight',
      format: { kind: 'unlimited' },
      startingPlayerIndex: 0,
    });
    const company = createLastSetupTemplate([{ name: 'Клуб 1' }, { name: 'Клуб 2' }], {
      mode: 'x01',
      startingScore: 701,
      outRule: 'double',
      format: { kind: 'unlimited' },
      startingPlayerIndex: 1,
    });
    await repository.save(lastSetupContext(), local);
    await repository.save(lastSetupContext('secret-a'), company);
    expect(await repository.load('local')).toEqual(local);
    expect(await repository.load('company:secret-a')).toEqual(company);
    expect(await repository.load('company:secret-b')).toBeUndefined();
  });
});

describe('Stage 4.6 today and player form', () => {
  it("uses only today's completed matches and excludes abandoned results from form", () => {
    const won = completed('won', 'a'),
      lost = completed('lost', 'b'),
      draw = completed('draw', undefined),
      abandoned = completed('abandoned', undefined, { a: 'Миша', b: 'Саша' }, 'abandoned');
    expect(recentForm([abandoned, lost, draw, won], 'a')).toEqual(['loss', 'draw', 'win']);
    expect(summarizeToday([won, lost, draw, abandoned], ['a', 'b'], new Date(at))).toMatchObject({
      completedMatches: 3,
      leader: { wins: 1, tied: true },
      bestVisit: { name: 'Миша', score: 60 },
      maximums: 0,
    });
  });

  it('does not aggregate temporary winners by a shared display name', () => {
    const first = completed('t1', 'temp-1', { 'temp-1': 'Гость', p: 'Миша' });
    const second = completed('t2', 'temp-2', { 'temp-2': 'Гость', p: 'Миша' });
    const summary = summarizeToday([first, second], ['p'], new Date(at));
    expect(summary).toMatchObject({ completedMatches: 2 });
    expect(summary?.leader).toBeUndefined();
  });

  it('returns no card for zero completed matches today and supports 3+ players', () => {
    const three = completed('three', 'c', { a: 'А', b: 'Б', c: 'В' });
    expect(summarizeToday([], ['a'], new Date(at))).toBeUndefined();
    expect(summarizeToday([three], ['a', 'b', 'c'], new Date(at))).toMatchObject({
      completedMatches: 1,
      leader: { name: 'В', wins: 1 },
    });
  });
});

describe('Stage 4.6 result sharing', () => {
  it('prepares a completed winner/tie card without ids, token, or URL', () => {
    const card = prepareResultShare(completed('internal-match-id', 'a'), [player('a', 'Миша')]);
    const serialized = JSON.stringify(card);
    expect(card).toMatchObject({ brand: 'Dart Scorekeeper', title: 'Миша побеждает' });
    expect(serialized).not.toContain('internal-match-id');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('http');
    expect(prepareResultShare(completed('tie', undefined), []).title).toBe('Ничья');
  });

  it('uses Web Share, falls back to download, and treats cancellation as normal', async () => {
    const file = new File([new Blob(['png'], { type: 'image/png' })], 'result.png', { type: 'image/png' });
    const share = vi.fn().mockResolvedValue(undefined),
      download = vi.fn();
    expect(
      await deliverResultFile(file, { canShare: () => true, share } as Pick<Navigator, 'share' | 'canShare'>, download),
    ).toBe('shared');
    expect(file.type).toBe('image/png');
    expect(await deliverResultFile(file, {} as Pick<Navigator, 'share' | 'canShare'>, download)).toBe('downloaded');
    expect(download).toHaveBeenCalledWith(file);
    share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    expect(
      await deliverResultFile(file, { canShare: () => true, share } as Pick<Navigator, 'share' | 'canShare'>, download),
    ).toBe('cancelled');
  });
});

describe('Stage 4.6 deterministic statistics load guard', () => {
  it.each([100, 500, 1000])('keeps player, comparison, H2H, and trends responsive for %i matches', (count) => {
    const matches = Array.from({ length: count }, (_, index) => completed(`m${index}`, index % 2 ? 'a' : 'b'));
    const started = performance.now();
    statisticsForPlayerHistory(matches, 'a');
    statisticsForPlayerHistory(matches, 'b');
    headToHead(matches, 'a', 'b');
    trendForPlayer(matches, 'a', 'threeDartAverage');
    expect(performance.now() - started).toBeLessThan(500);
  });
});
