import type { Match, Player } from '../domain/match/models';
export type SharedCompany = Readonly<{ token: string; name: string; createdAt: string }>;
type SharedMatchCache = Readonly<{ token: string; match: Match; state: 'pending' | 'synced' | 'error' }>;
type SharedCache = { saveCompany(company: SharedCompany): Promise<void>; players(token: string): Promise<readonly Player[]>; savePlayers(token: string, players: readonly Player[]): Promise<void>; matches(token: string): Promise<readonly SharedMatchCache[]>; mergeRemote(token: string, matches: readonly Match[]): Promise<void>; setState(token: string, matchId: string, state: SharedMatchCache['state']): Promise<void> };

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Компания не найдена или ссылка недействительна.' : 'Не удалось связаться с компанией.');
  return response.json() as Promise<T>;
};
export class CompanySync {
  constructor(private readonly cache: SharedCache) {}
  async create(name: string): Promise<SharedCompany> {
    const result = await request<{ token: string; group: { name: string; createdAt: string } }>('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
    const company = { token: result.token, ...result.group }; await this.cache.saveCompany(company); return company;
  }
  async open(token: string): Promise<SharedCompany> {
    const result = await request<{ group: { name: string; createdAt: string }; players: Player[]; matches: Match[] }>(`/api/groups/${encodeURIComponent(token)}`);
    const company = { token, ...result.group }; await this.cache.saveCompany(company); await this.cache.savePlayers(token, result.players); await this.cache.mergeRemote(token, result.matches); return company;
  }
  async addPlayer(token: string, name: string): Promise<Player> {
    const result = await request<{ player: Player }>(`/api/groups/${encodeURIComponent(token)}/players`, { method: 'POST', body: JSON.stringify({ name }) });
    const players = await this.cache.players(token); await this.cache.savePlayers(token, [...players, result.player]); return result.player;
  }
  async sync(token: string): Promise<void> {
    const cached = await this.cache.matches(token);
    for (const item of cached.filter(item => item.state !== 'synced')) {
      try { await request(`/api/groups/${encodeURIComponent(token)}/matches/${encodeURIComponent(item.match.id)}`, { method: 'PUT', body: JSON.stringify(item.match) }); await this.cache.setState(token, item.match.id, 'synced'); }
      catch { await this.cache.setState(token, item.match.id, 'error'); }
    }
    const result = await request<{ players: Player[]; matches: Match[] }>(`/api/groups/${encodeURIComponent(token)}`);
    await this.cache.savePlayers(token, result.players); await this.cache.mergeRemote(token, result.matches);
  }
}
