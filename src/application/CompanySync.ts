import type { Match, Player } from '../domain/match/models';
import type { CompanyGateway, SharedCompany } from './ports/companyGateway';
export type { SharedCompany } from './ports/companyGateway';
type SharedMatchCache = Readonly<{ token: string; match: Match; state: 'pending' | 'synced' | 'error' }>;
type SharedCache = { saveCompany(company: SharedCompany): Promise<void>; players(token: string): Promise<readonly Player[]>; savePlayers(token: string, players: readonly Player[]): Promise<void>; matches(token: string): Promise<readonly SharedMatchCache[]>; mergeRemote(token: string, matches: readonly Match[]): Promise<void>; setState(token: string, matchId: string, state: SharedMatchCache['state']): Promise<void> };

export class CompanySync {
  constructor(private readonly cache: SharedCache, private readonly gateway: CompanyGateway) {}
  async create(name: string): Promise<SharedCompany> {
    const company = await this.gateway.createCompany(name); await this.cache.saveCompany(company); return company;
  }
  async open(token: string): Promise<SharedCompany> {
    const result = await this.gateway.loadCompany(token); const company = { token, ...result.company }; await this.cache.saveCompany(company); await this.cache.savePlayers(token, result.players); await this.cache.mergeRemote(token, result.matches); return company;
  }
  async addPlayer(token: string, name: string): Promise<Player> {
    const player = await this.gateway.createPlayer(token, name); const players = await this.cache.players(token); await this.cache.savePlayers(token, [...players, player]); return player;
  }
  async sync(token: string): Promise<void> {
    const cached = await this.cache.matches(token);
    for (const item of cached.filter(item => item.state !== 'synced')) {
      try { await this.gateway.uploadMatch(token, item.match); await this.cache.setState(token, item.match.id, 'synced'); }
      catch { await this.cache.setState(token, item.match.id, 'error'); }
    }
    const result = await this.gateway.loadCompany(token);
    await this.cache.savePlayers(token, result.players); await this.cache.mergeRemote(token, result.matches);
  }
}
