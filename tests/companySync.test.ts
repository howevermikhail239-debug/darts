import { describe, expect, it } from 'vitest';
import { CompanySync } from '../src/application/CompanySync';
import type { CompanyGateway, CompanySnapshot, SharedCompany } from '../src/application/ports/companyGateway';
import type { Match, Player } from '../src/domain/match/models';

const company: SharedCompany = { token: 'company-token', name: 'Лига', createdAt: '2026-09-10T10:00:00.000Z' };
const player: Player = { id: 'player-1', name: 'Миша', createdAt: '2026-09-10T10:00:00.000Z' };
const match = (id: string): Match => ({
  id, createdAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T10:01:00.000Z', status: 'abandoned',
  players: ['player-1', 'player-2'], startingPlayerIndex: 0, currentPlayerIndex: 0,
  participantNames: { 'player-1': 'Миша', 'player-2': 'Илья' }, confirmedVisits: [],
  state: { kind: 'x01', startingScore: 501, outRule: 'straight', format: { kind: 'unlimited' }, remaining: { 'player-1': 501, 'player-2': 501 }, visitsCompleted: { 'player-1': 0, 'player-2': 0 }, phase: { kind: 'regulation' } },
});
type CachedMatch = Readonly<{ token: string; match: Match; state: 'pending' | 'synced' | 'error' }>;

class MemoryCache {
  savedCompanies: SharedCompany[] = [];
  savedPlayers: readonly Player[] = [];
  cachedMatches: CachedMatch[] = [];
  merged: Match[] = [];
  states: Array<{ matchId: string; state: CachedMatch['state'] }> = [];
  async saveCompany(value: SharedCompany) { this.savedCompanies.push(value); }
  async players() { return this.savedPlayers; }
  async savePlayers(token: string, values: readonly Player[]) { void token; this.savedPlayers = values; }
  async matches() { return this.cachedMatches; }
  async mergeRemote(token: string, values: readonly Match[]) { void token; this.merged.push(...values); }
  async setState(token: string, matchId: string, state: CachedMatch['state']) {
    this.states.push({ matchId, state });
    this.cachedMatches = this.cachedMatches.map((item) => item.token === token && item.match.id === matchId ? { ...item, state } : item);
  }
}

class FakeGateway implements CompanyGateway {
  uploaded: string[] = [];
  failLoad = false;
  constructor(private readonly snapshot: CompanySnapshot, readonly failingIds = new Set<string>()) {}
  async createCompany() { return company; }
  async loadCompany() { if (this.failLoad) throw new Error('offline'); return this.snapshot; }
  async createPlayer() { return player; }
  async uploadMatch(token: string, value: Match) {
    void token;
    this.uploaded.push(value.id);
    if (this.failingIds.has(value.id)) throw new Error('offline');
  }
}

describe('CompanySync', () => {
  it('uses its gateway to create, open, and add company data while caching the result', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway({ company: { name: company.name, createdAt: company.createdAt }, players: [player], matches: [match('remote')] });
    const sync = new CompanySync(cache, gateway);

    await expect(sync.create('Лига')).resolves.toEqual(company);
    await expect(sync.open(company.token)).resolves.toEqual(company);
    await expect(sync.addPlayer(company.token, 'Миша')).resolves.toEqual(player);

    expect(cache.savedCompanies).toEqual([company, company]);
    expect(cache.savedPlayers).toEqual([player, player]);
    expect(cache.merged).toEqual([match('remote')]);
  });

  it('uploads pending matches, retains upload failures for retry, then merges the remote snapshot', async () => {
    const cache = new MemoryCache();
    cache.cachedMatches = [
      { token: company.token, match: match('pending'), state: 'pending' },
      { token: company.token, match: match('failed'), state: 'error' },
      { token: company.token, match: match('already-synced'), state: 'synced' },
    ];
    const gateway = new FakeGateway({ company: { name: company.name, createdAt: company.createdAt }, players: [player], matches: [match('remote')] }, new Set(['failed']));

    await new CompanySync(cache, gateway).sync(company.token);

    expect(gateway.uploaded).toEqual(['pending', 'failed']);
    expect(cache.states).toEqual([{ matchId: 'pending', state: 'synced' }, { matchId: 'failed', state: 'error' }]);
    expect(cache.savedPlayers).toEqual([player]);
    expect(cache.merged).toEqual([match('remote')]);

    gateway.failingIds.delete('failed');
    await new CompanySync(cache, gateway).sync(company.token);
    expect(gateway.uploaded).toEqual(['pending', 'failed', 'failed']);
    expect(cache.states.at(-1)).toEqual({ matchId: 'failed', state: 'synced' });
  });

  it('propagates a transport failure without corrupting the cache', async () => {
    const cache = new MemoryCache();
    const gateway = new FakeGateway({ company: { name: company.name, createdAt: company.createdAt }, players: [player], matches: [] });
    gateway.failLoad = true;
    await expect(new CompanySync(cache, gateway).open(company.token)).rejects.toThrow('offline');
    expect(cache.savedCompanies).toEqual([]);
    expect(cache.savedPlayers).toEqual([]);
  });
});
