import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { bull, miss, numberThrow, outerBull } from '../src/domain/darts/DartThrow';
import { createMatch } from '../src/domain/match/createMatch';
import { addDraftThrow, emptyDraft } from '../src/domain/match/VisitDraft';
import type { Match } from '../src/domain/match/models';
import { X01Rules } from '../src/domain/rules/X01Rules';
import { GameSession } from '../src/application/GameSession';
import type { ActiveMatchRecord, MatchRepository } from '../src/application/ports/repositories';
import { statisticsForMatch } from '../src/domain/statistics/StatisticsCalculator';
import { exportBackup, restoreBackup } from '../src/application/BackupService';
import { IndexedDbBackupRepository, IndexedDbMatchRepository, IndexedDbPlayerRepository, LocalSettingsRepository, clearLocalData } from '../src/infrastructure/persistence/IndexedDbRepositories';

const now = '2026-09-08T12:00:00.000Z';
const detailed = (...darts: ReturnType<typeof miss>[]) => darts.reduce(addDraftThrow, emptyDraft());
function near(score: number, outRule: 'straight' | 'double' = 'straight'): Match {
  const match = createMatch('m', ['a', 'b'], { mode: 'x01', startingScore: 501, outRule, format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, now);
  if (match.state.kind !== 'x01') throw new Error('test setup');
  return { ...match, state: { ...match.state, remaining: { a: score, b: 501 } } };
}
class MemoryRepo implements MatchRepository {
  active: ActiveMatchRecord | undefined;
  async saveActive(record: ActiveMatchRecord) { this.active = structuredClone(record); }
  async loadActive() { return this.active; }
  async archiveAndClearActive() { this.active = undefined; }
  async listHistory() { return []; }
}

describe('Stage 3 X01', () => {
  const rules = new X01Rules();
  it.each([301, 501, 701] as const)('starts X01 at %i', (startingScore) => {
    const match = createMatch('x', ['a', 'b'], { mode: 'x01', startingScore, outRule: 'straight', format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, now);
    expect(match.state).toMatchObject({ kind: 'x01', startingScore, outRule: 'straight', remaining: { a: startingScore, b: startingScore } });
  });
  it.each([301, 501, 701] as const)('supports double-out with starting score %i', (startingScore) => {
    const match = createMatch('x', ['a', 'b'], { mode: 'x01', startingScore, outRule: 'double', format: { kind: 'unlimited' }, startingPlayerIndex: 0 }, now);
    expect(match.state).toMatchObject({ startingScore, outRule: 'double' });
  });
  it('accepts doubles and Bull, rejects outer Bull and a single to zero', () => {
    expect(rules.evaluateDraft(detailed(numberThrow(20, 2)), near(40, 'double')).status).toBe('match_won');
    expect(rules.evaluateDraft(detailed(numberThrow(1, 2)), near(2, 'double')).status).toBe('match_won');
    expect(rules.evaluateDraft(detailed(bull()), near(50, 'double')).status).toBe('match_won');
    expect(rules.evaluateDraft(detailed(outerBull(), outerBull()), near(50, 'double'))).toMatchObject({ status: 'bust', awardedScore: 0 });
    expect(rules.evaluateDraft(detailed(numberThrow(20, 1), numberThrow(20, 1)), near(40, 'double'))).toMatchObject({ status: 'bust', awardedScore: 0 });
  });
  it('supports S1 + D1 from 3 and busts on remaining 1 or below zero', () => {
    expect(rules.evaluateDraft(detailed(numberThrow(1, 1), numberThrow(1, 2)), near(3, 'double')).status).toBe('match_won');
    expect(rules.evaluateDraft(detailed(numberThrow(1, 1)), near(2, 'double')).status).toBe('bust');
    expect(rules.evaluateDraft(detailed(numberThrow(20, 3)), near(40, 'double')).status).toBe('bust');
  });
  it('keeps real hits but awards zero on a double-out bust', async () => {
    const repo = new MemoryRepo(); const session = new GameSession(near(40, 'double'), repo, ()=>'v', ()=>now);
    await session.record(numberThrow(20, 1)); await session.record(numberThrow(20, 1)); await session.confirm();
    expect(statisticsForMatch(session.snapshot().match).a).toMatchObject({ rawPoints: 40, awardedPoints: 0, singles: 2, physicalDarts: 2 });
  });
});

describe('aggregate visit input', () => {
  it('persists, restores and confirms a full aggregate visit without inventing hits', async () => {
    const repo = new MemoryRepo(); const match = createMatch('agg', ['a','b'], { mode:'x01', startingScore:301, outRule:'straight', format:{kind:'unlimited'}, startingPlayerIndex:0 }, now);
    const session = new GameSession(match, repo, ()=>'visit', ()=>now);
    await session.setInputMode('aggregate'); await session.setAggregateScore(100);
    const restored = new GameSession(repo.active!.current, repo, ()=>'visit', ()=>now, repo.active!.previous, repo.active!.draft);
    expect(restored.snapshot().draft).toMatchObject({ kind:'aggregate', score:100 });
    expect(restored.snapshot().match).toEqual(match);
    await restored.confirm();
    expect(restored.snapshot().match.state).toMatchObject({ remaining:{a:201,b:301} });
    const stats = statisticsForMatch(restored.snapshot().match).a!;
    expect(stats).toMatchObject({ visits:1, physicalDarts:3, knownHitDarts:0, rawPoints:100, awardedPoints:100, bestVisit:100, singles:0, doubles:0, triples:0, misses:0 });
    expect(stats.thresholds['100+']).toBe(1);
  });
  it.each([-1, 181, 12.5, 179])('rejects invalid or unreachable aggregate score %s', async (score) => {
    const repo = new MemoryRepo(); const match = createMatch('agg', ['a','b'], { mode:'fixed_visits', visitsPerPlayer:1, startingPlayerIndex:0 }, now);
    const session = new GameSession(match, repo, ()=>'visit', ()=>now);
    await session.setInputMode('aggregate'); await session.setAggregateScore(score);
    expect(session.snapshot().evaluation.status).toBe('invalid');
    await expect(session.confirm()).rejects.toThrow();
  });
  it('requires detailed darts for a possible X01 checkout and protects a non-empty mode switch', async () => {
    const repo = new MemoryRepo(); const session = new GameSession(near(100), repo, ()=>'visit', ()=>now);
    await session.setInputMode('aggregate'); await session.setAggregateScore(100);
    expect(session.snapshot().evaluation).toMatchObject({ status:'invalid' });
    await expect(session.setInputMode('detailed')).rejects.toThrow('Сначала сбросьте');
    expect(session.snapshot().draft).toMatchObject({ kind:'aggregate', score:100 });
  });
  it('undo restores the checkpoint after an aggregate visit', async () => {
    const repo = new MemoryRepo(); const match = createMatch('agg', ['a','b'], { mode:'x01', startingScore:301, outRule:'straight', format:{kind:'unlimited'}, startingPlayerIndex:0 }, now);
    const session = new GameSession(match, repo, ()=>'visit', ()=>now);
    await session.setInputMode('aggregate'); await session.setAggregateScore(100); await session.confirm(); await session.undo();
    expect(session.snapshot().match).toEqual(match);
  });
});

describe('backup', () => {
  afterEach(() => clearLocalData());
  it('roundtrips profiles, history, active draft and checkpoint', async () => {
    const matches = new IndexedDbMatchRepository(), players = new IndexedDbPlayerRepository(), backups = new IndexedDbBackupRepository();
    const active = createMatch('active', ['a','b'], { mode:'x01', startingScore:701, outRule:'double', format:{kind:'unlimited'}, startingPlayerIndex:0 }, now);
    const history = { ...createMatch('history', ['temp-a','temp-b'], { mode:'fixed_visits', visitsPerPlayer:1, startingPlayerIndex:0 }, now, {'temp-a':'Игрок 1','temp-b':'Игрок 2'}), status:'abandoned' as const, completedAt:now };
    await players.save({ id:'saved', name:'Миша', createdAt:now });
    await matches.archiveAndClearActive(history);
    await new LocalSettingsRepository().save({ inputMode:'aggregate' });
    await matches.saveActive({ current:active, previous:active, draft:{ playerId:'a', draft:{kind:'aggregate', score:100, darts:[]} } });
    const json = await exportBackup(backups, ()=>now);
    await clearLocalData();
    await restoreBackup(new IndexedDbBackupRepository(), json);
    expect(await new IndexedDbPlayerRepository().list()).toMatchObject([{id:'saved',name:'Миша'}]);
    expect(await new IndexedDbMatchRepository().loadActive()).toMatchObject({ current:{id:'active',state:{startingScore:701,outRule:'double'}}, previous:{id:'active'}, draft:{draft:{kind:'aggregate',score:100}} });
    expect(await new IndexedDbMatchRepository().listHistory()).toMatchObject([{id:'history',participantNames:{'temp-a':'Игрок 1','temp-b':'Игрок 2'}}]);
    expect(await new LocalSettingsRepository().load()).toEqual({inputMode:'aggregate'});
  });
  it.each(['not json', '{}', '{"type":"darts-scorekeeper-backup","version":99,"data":{}}'])('rejects invalid input without changing current data: %s', async (json) => {
    const matches = new IndexedDbMatchRepository(); const active = createMatch('keep', ['a','b'], { mode:'x01', format:{kind:'unlimited'}, startingPlayerIndex:0 }, now);
    await matches.saveActive({current:active,draft:{playerId:'a',draft:emptyDraft()}});
    await expect(restoreBackup(new IndexedDbBackupRepository(), json)).rejects.toThrow();
    expect((await matches.loadActive())?.current.id).toBe('keep');
  });
});
