import { describe, expect, it, vi } from 'vitest';
import { CompanySync } from '../src/application/CompanySync';
import {
  HttpError,
  type CompanyGateway,
  type CompanySnapshot,
  type SharedCompany,
} from '../src/application/ports/companyGateway';
import type { SharedMatchState } from '../src/application/ports/repositories';
import type { Match, Player } from '../src/domain/match/models';

const company: SharedCompany = { token: 'company-token', name: 'Лига', createdAt: '2026-09-10T10:00:00.000Z' };
const player: Player = { id: 'player-1', name: 'Миша', createdAt: '2026-09-10T10:00:00.000Z' };
const match = (id: string): Match => ({
  id,
  createdAt: '2026-09-10T10:00:00.000Z',
  completedAt: '2026-09-10T10:01:00.000Z',
  status: 'abandoned',
  players: ['player-1', 'player-2'],
  startingPlayerIndex: 0,
  currentPlayerIndex: 0,
  participantNames: { 'player-1': 'Миша', 'player-2': 'Илья' },
  confirmedVisits: [],
  state: {
    kind: 'x01',
    startingScore: 501,
    outRule: 'straight',
    format: { kind: 'unlimited' },
    remaining: { 'player-1': 501, 'player-2': 501 },
    visitsCompleted: { 'player-1': 0, 'player-2': 0 },
    phase: { kind: 'regulation' },
  },
});
type CachedMatch = Readonly<{
  token: string;
  match: Match;
  state: SharedMatchState;
  reason?: string;
  attempts?: number;
  failedAt?: string;
}>;
type Details = Readonly<{ reason?: string; attempts?: number; failedAt?: string }>;

class MemoryCache {
  savedCompanies: SharedCompany[] = [];
  savedPlayers: readonly Player[] = [];
  cachedMatches: CachedMatch[] = [];
  merged: Match[] = [];
  forgotten: string[] = [];
  states: Array<{ matchId: string; state: SharedMatchState; details?: Details }> = [];
  async saveCompany(value: SharedCompany) {
    this.savedCompanies.push(value);
  }
  async players() {
    return this.savedPlayers;
  }
  async savePlayers(token: string, values: readonly Player[]) {
    void token;
    this.savedPlayers = values;
  }
  async updatePlayers(token: string, mutate: (current: readonly Player[]) => readonly Player[]) {
    void token;
    // Имитация транзакции: чтение и запись происходят атомарно относительно других мутаций.
    this.savedPlayers = mutate(this.savedPlayers);
    return this.savedPlayers;
  }
  async matches() {
    return this.cachedMatches;
  }
  async mergeRemote(token: string, values: readonly Match[]) {
    void token;
    this.merged.push(...values.filter((value) => !this.forgotten.includes(value.id)));
  }
  async setState(token: string, matchId: string, state: SharedMatchState, details?: Details) {
    this.states.push({ matchId, state, ...(details ? { details } : {}) });
    this.cachedMatches = this.cachedMatches.map((item) =>
      item.token === token && item.match.id === matchId ? { ...item, state, ...details } : item,
    );
  }
  async forgetMatch(token: string, matchId: string) {
    void token;
    this.forgotten.push(matchId);
    this.cachedMatches = this.cachedMatches.filter((item) => item.match.id !== matchId);
  }
}

class FakeGateway implements CompanyGateway {
  uploaded: string[] = [];
  deleted: string[] = [];
  failLoad = false;
  inFlight = 0;
  peakInFlight = 0;
  uploadDelayMs = 0;
  rejectPermanently = new Set<string>();
  constructor(
    private readonly snapshot: CompanySnapshot,
    readonly failingIds = new Set<string>(),
  ) {}
  async createCompany() {
    return company;
  }
  async loadCompany() {
    if (this.failLoad) throw new Error('offline');
    return this.snapshot;
  }
  async createPlayer(token: string, name: string) {
    void token;
    return { ...player, id: `id-${name}`, name };
  }
  async renamePlayer(token: string, playerId: string, name: string) {
    void token;
    return { ...player, id: playerId, name };
  }
  async resetPlayerStatistics(token: string, playerId: string) {
    void token;
    return { ...player, id: playerId, statsResetAt: '2026-09-11T12:00:00.000Z' };
  }
  async deletePlayer() {}
  async deleteMatch(token: string, matchId: string) {
    void token;
    this.deleted.push(matchId);
  }
  async uploadMatch(token: string, value: Match) {
    void token;
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      if (this.uploadDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.uploadDelayMs));
      this.uploaded.push(value.id);
      if (this.rejectPermanently.has(value.id))
        throw new HttpError('Матч слишком большой для отправки в компанию.', 413);
      if (this.failingIds.has(value.id)) throw new HttpError('Сервер компании временно недоступен (код 503).', 503);
    } finally {
      this.inFlight -= 1;
    }
  }
}

const snapshot = (matches: readonly Match[] = [], players: readonly Player[] = [player]): CompanySnapshot => ({
  company: { name: company.name, createdAt: company.createdAt },
  players,
  matches,
});

describe('CompanySync', () => {
  it('uses its gateway to create, open, and add company data while caching the result', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway(snapshot([match('remote')]));
    const sync = new CompanySync(cache, gateway);

    await expect(sync.create('Лига')).resolves.toEqual(company);
    await expect(sync.open(company.token)).resolves.toEqual(company);
    await sync.addPlayer(company.token, 'Миша');

    expect(cache.savedCompanies).toEqual([company, company]);
    expect(cache.savedPlayers.map((item) => item.name)).toEqual(['Миша', 'Миша']);
    expect(cache.merged).toEqual([match('remote')]);
  });

  it('uploads pending matches, retains upload failures for retry, then merges the remote snapshot', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [
      { token: company.token, match: match('pending'), state: 'pending' },
      { token: company.token, match: match('failed'), state: 'error' },
      { token: company.token, match: match('already-synced'), state: 'synced' },
    ];
    const gateway = new FakeGateway(snapshot([match('remote')]), new Set(['failed']));
    let clock = Date.parse('2026-09-11T12:00:00.000Z');
    const now = () => new Date(clock).toISOString();

    await new CompanySync(cache, gateway, now).sync(company.token);

    expect(gateway.uploaded.sort()).toEqual(['failed', 'pending']);
    expect(
      cache.states
        .map((item) => ({ matchId: item.matchId, state: item.state }))
        .sort((a, b) => a.matchId.localeCompare(b.matchId)),
    ).toEqual([
      { matchId: 'failed', state: 'error' },
      { matchId: 'pending', state: 'synced' },
    ]);
    expect(cache.savedPlayers).toEqual([player]);
    expect(cache.merged).toEqual([match('remote')]);

    gateway.failingIds.delete('failed');
    clock += 60_000;
    await new CompanySync(cache, gateway, now).sync(company.token);
    expect(cache.states.at(-1)).toMatchObject({ matchId: 'failed', state: 'synced' });
  });

  it('moves a permanently rejected match to rejected and never retries it', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [{ token: company.token, match: match('too-big'), state: 'pending' }];
    const gateway = new FakeGateway(snapshot());
    gateway.rejectPermanently.add('too-big');
    const sync = new CompanySync(cache, gateway);

    await sync.sync(company.token);
    expect(cache.cachedMatches[0]?.state).toBe('rejected');
    expect(cache.cachedMatches[0]?.reason).toContain('слишком большой');

    for (let attempt = 0; attempt < 5; attempt += 1) await sync.sync(company.token);
    expect(gateway.uploaded).toEqual(['too-big']);
  });

  it('waits before retrying a retryable failure instead of hammering the server', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [{ token: company.token, match: match('flaky'), state: 'pending' }];
    const gateway = new FakeGateway(snapshot(), new Set(['flaky']));
    let clock = Date.parse('2026-09-11T12:00:00.000Z');
    const sync = new CompanySync(cache, gateway, () => new Date(clock).toISOString());

    await sync.sync(company.token);
    expect(gateway.uploaded).toEqual(['flaky']);
    expect(cache.cachedMatches[0]).toMatchObject({ state: 'error', attempts: 1 });

    clock += 1_000;
    await sync.sync(company.token);
    expect(gateway.uploaded).toEqual(['flaky']);

    clock += 10 * 60_000;
    await sync.sync(company.token);
    expect(gateway.uploaded).toEqual(['flaky', 'flaky']);
  });

  it('lets an explicit retry bypass backoff without retrying permanent failures', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [
      { token: company.token, match: match('flaky'), state: 'pending' },
      { token: company.token, match: match('too-big'), state: 'rejected' },
    ];
    const gateway = new FakeGateway(snapshot(), new Set(['flaky']));
    const sync = new CompanySync(cache, gateway, () => '2026-09-11T12:00:00.000Z');

    await sync.sync(company.token);
    expect(gateway.uploaded).toEqual(['flaky']);
    gateway.failingIds.delete('flaky');

    await sync.sync(company.token, true);
    expect(gateway.uploaded).toEqual(['flaky', 'flaky']);
    expect(cache.cachedMatches.find((item) => item.match.id === 'flaky')).toMatchObject({ state: 'synced' });
    expect(gateway.uploaded).not.toContain('too-big');
  });

  it('uploads in parallel and refuses to run two syncs at once', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = Array.from({ length: 9 }, (_unused, index) => ({
      token: company.token,
      match: match(`m${index}`),
      state: 'pending' as const,
    }));
    const gateway = new FakeGateway(snapshot());
    gateway.uploadDelayMs = 5;
    const sync = new CompanySync(cache, gateway);

    const first = sync.sync(company.token);
    const second = sync.sync(company.token);
    await Promise.all([first, second]);

    expect(gateway.uploaded).toHaveLength(9);
    expect(gateway.peakInFlight).toBeGreaterThan(1);
    expect(gateway.peakInFlight).toBeLessThanOrEqual(3);
  });

  it('forgets a deleted match locally even when it was still pending', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [{ token: company.token, match: match('ghost'), state: 'pending' }];
    const gateway = new FakeGateway(snapshot([match('ghost')]));
    const sync = new CompanySync(cache, gateway);

    await sync.deleteMatch(company.token, 'ghost');
    expect(gateway.deleted).toEqual(['ghost']);
    expect(cache.cachedMatches).toEqual([]);
    expect(cache.merged).toEqual([]);

    await sync.sync(company.token);
    expect(gateway.uploaded).toEqual([]);
  });

  it('serialises concurrent player mutations so neither is lost', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway(snapshot());
    const sync = new CompanySync(cache, gateway);
    await Promise.all([sync.addPlayer(company.token, 'A'), sync.addPlayer(company.token, 'B')]);
    expect(cache.savedPlayers.map((item) => item.name).sort()).toEqual(['A', 'B']);
  });

  it('does not lose a player created while a sync is in flight', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway(snapshot([], [player]));
    gateway.uploadDelayMs = 5;
    cache.cachedMatches = [{ token: company.token, match: match('slow'), state: 'pending' }];
    const sync = new CompanySync(cache, gateway);
    const syncing = sync.sync(company.token);
    const adding = sync.addPlayer(company.token, 'Новый');
    await Promise.all([syncing, adding]);
    expect(cache.savedPlayers.map((item) => item.name)).toContain('Новый');
  });

  it('reports how many server records were skipped so the interface can say so', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway({ ...snapshot([match('remote')]), skippedMatches: 2, skippedPlayers: 1 });
    const sync = new CompanySync(cache, gateway);
    expect(sync.lastSnapshotIssues()).toBeUndefined();
    await sync.open(company.token);
    expect(sync.lastSnapshotIssues()).toEqual({ skippedMatches: 2, skippedPlayers: 1 });
    await sync.sync(company.token);
    expect(sync.lastSnapshotIssues()).toEqual({ skippedMatches: 2, skippedPlayers: 1 });
  });

  it('propagates a transport failure without corrupting the cache', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway(snapshot([]));
    gateway.failLoad = true;
    await expect(new CompanySync(cache, gateway).open(company.token)).rejects.toThrow('offline');
    expect(cache.savedCompanies).toEqual([]);
    expect(cache.savedPlayers).toEqual([]);
  });

  it('keeps working when the cache has no transactional helpers', async () => {
    const cache = new MemoryCache();
    const minimal = {
      saveCompany: cache.saveCompany.bind(cache),
      players: cache.players.bind(cache),
      savePlayers: cache.savePlayers.bind(cache),
      matches: cache.matches.bind(cache),
      mergeRemote: cache.mergeRemote.bind(cache),
      setState: cache.setState.bind(cache),
    };
    const gateway = new FakeGateway(snapshot());
    const sync = new CompanySync(minimal, gateway);
    await sync.addPlayer(company.token, 'Один');
    expect(cache.savedPlayers.map((item) => item.name)).toEqual(['Один']);
    await expect(sync.deleteMatch(company.token, 'unknown')).resolves.toBeUndefined();
  });
});

describe('CompanySync reentrancy', () => {
  it('returns the same in-flight promise for a second sync call', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway(snapshot());
    const loadCompany = vi.spyOn(gateway, 'loadCompany');
    const sync = new CompanySync(cache, gateway);
    await Promise.all([sync.sync(company.token), sync.sync(company.token)]);
    expect(loadCompany).toHaveBeenCalledTimes(1);
  });
});
