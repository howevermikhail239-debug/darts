import type { Match, Player } from '../../domain/match/models';
import type { CompanyGateway, CompanySnapshot, SharedCompany } from '../../application/ports/companyGateway';
const request = async (path: string, options?: RequestInit): Promise<unknown> => {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Компания не найдена или ссылка недействительна.' : 'Не удалось связаться с компанией.');
  return response.json() as Promise<unknown>;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const invalidResponse = (): never => { throw new Error('Сервер компании вернул некорректные данные.'); };
const companyFields = (value: unknown): Omit<SharedCompany, 'token'> => {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.createdAt !== 'string') return invalidResponse();
  return { name: value.name, createdAt: value.createdAt };
};
const player = (value: unknown): Player => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.createdAt !== 'string') return invalidResponse();
  return { id: value.id, name: value.name, createdAt: value.createdAt };
};
export class HttpCompanyGateway implements CompanyGateway {
  async createCompany(name: string): Promise<SharedCompany> { const result = await request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) }); if (!isRecord(result) || typeof result.token !== 'string') return invalidResponse(); return { token: result.token, ...companyFields(result.group) }; }
  async loadCompany(token: string): Promise<CompanySnapshot> { const result = await request(`/api/groups/${encodeURIComponent(token)}`); if (!isRecord(result) || !Array.isArray(result.players) || !Array.isArray(result.matches) || !result.matches.every(isRecord)) return invalidResponse(); return { company: companyFields(result.group), players: result.players.map(player), matches: result.matches as Match[] }; }
  async createPlayer(token: string, name: string): Promise<Player> { const result = await request(`/api/groups/${encodeURIComponent(token)}/players`, { method: 'POST', body: JSON.stringify({ name }) }); return isRecord(result) ? player(result.player) : invalidResponse(); }
  async uploadMatch(token: string, match: Match): Promise<void> { await request(`/api/groups/${encodeURIComponent(token)}/matches/${encodeURIComponent(match.id)}`, { method: 'PUT', body: JSON.stringify(match) }); }
}
