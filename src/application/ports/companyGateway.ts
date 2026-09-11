import type { Match, Player } from '../../domain/match/models';
export type SharedCompany = Readonly<{ token: string; name: string; createdAt: string }>;
export type CompanySnapshot = Readonly<{ company: Omit<SharedCompany, 'token'>; players: readonly Player[]; matches: readonly Match[] }>;
export interface CompanyGateway {
  createCompany(name: string): Promise<SharedCompany>;
  loadCompany(token: string): Promise<CompanySnapshot>;
  createPlayer(token: string, name: string): Promise<Player>;
  renamePlayer(token: string, playerId: string, name: string): Promise<Player>;
  resetPlayerStatistics(token: string, playerId: string): Promise<Player>;
  deletePlayer(token: string, playerId: string): Promise<void>;
  uploadMatch(token: string, match: Match): Promise<void>;
  deleteMatch(token: string, matchId: string): Promise<void>;
}
