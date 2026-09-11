import type { Match, Player } from '../../domain/match/models';
import { isSharedMatch, isSharedPlayer, migrateMatch } from '../../domain/match/validation';
import { HttpError, type CompanyGateway, type CompanySnapshot, type SharedCompany } from '../../application/ports/companyGateway';

/** Зеркало серверного ограничения на размер тела запроса (server.mjs). */
export const MAX_UPLOAD_BYTES = 512 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
export const IDEMPOTENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const invalidResponse = (): never => { throw new Error('Сервер компании вернул некорректные данные.'); };

const statusMessage = (status: number): string => {
  if (status === 404) return 'Компания не найдена или ссылка недействительна.';
  if (status === 401 || status === 403) return 'Нет доступа к этой компании.';
  if (status === 409) return 'Данные компании изменились на сервере. Обновите страницу и повторите.';
  if (status === 413) return 'Матч слишком большой для отправки в компанию.';
  if (status === 429) return 'Слишком много запросов к компании. Повторите чуть позже.';
  if (status === 408) return 'Сервер компании не ответил вовремя.';
  if (status >= 500) return `Сервер компании временно недоступен (код ${status}).`;
  return `Сервер компании отклонил запрос (код ${status}).`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (attempt: number): number => RETRY_BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random());

async function fetchOnce(path: string, options: RequestInit | undefined, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
    });
  } catch (cause) {
    if (controller.signal.aborted) throw new HttpError('Сервер компании не ответил вовремя.', 408, false);
    throw new Error('Не удалось связаться с компанией. Проверьте подключение.', { cause });
  } finally {
    clearTimeout(timer);
  }
  let body: string;
  try {
    body = await response.text();
  } catch {
    if (!response.ok) throw new HttpError(statusMessage(response.status), response.status);
    throw new Error('Не удалось прочитать ответ сервера компании.');
  }
  if (!response.ok) throw new HttpError(statusMessage(response.status), response.status);
  if (body.trim().length === 0) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // Не-JSON ответ (captive-портал, страница ошибки прокси) не должен утекать сырым SyntaxError.
    throw new Error('Сервер компании вернул не JSON. Возможно, вы подключены к сети с авторизацией.');
  }
}

const isIdempotent = (method: string | undefined): boolean => (method ?? 'GET').toUpperCase() === 'GET';

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const attempts = isIdempotent(options?.method) ? IDEMPOTENT_RETRIES + 1 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchOnce(path, options, REQUEST_TIMEOUT_MS);
    } catch (cause) {
      lastError = cause;
      const permanent = cause instanceof HttpError && cause.permanent;
      if (permanent || attempt === attempts - 1) throw cause;
      await sleep(jitter(attempt));
    }
  }
  throw lastError;
}

const companyFields = (value: unknown): Omit<SharedCompany, 'token'> => {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.createdAt !== 'string') return invalidResponse();
  return { name: value.name, createdAt: value.createdAt };
};
const player = (value: unknown): Player => {
  if (!isSharedPlayer(value)) return invalidResponse();
  return { id: value.id, name: value.name, createdAt: value.createdAt, ...(typeof value.statsResetAt === 'string' ? { statsResetAt: value.statsResetAt } : {}) };
};
const sharedPlayer = (value: unknown): Player | undefined => {
  if (!isSharedPlayer(value)) return undefined;
  return { id: value.id, name: value.name, createdAt: value.createdAt, ...(typeof value.statsResetAt === 'string' ? { statsResetAt: value.statsResetAt } : {}) };
};

export class HttpCompanyGateway implements CompanyGateway {
  async createCompany(name: string): Promise<SharedCompany> {
    const result = await request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
    if (!isRecord(result) || typeof result.token !== 'string') return invalidResponse();
    return { token: result.token, ...companyFields(result.group) };
  }
  /**
   * Одна плохая запись больше не делает компанию недоступной: матчи мигрируются и
   * отбраковываются поштучно — ровно так же, как локальная история.
   */
  async loadCompany(token: string): Promise<CompanySnapshot> {
    const result = await request(`/api/groups/${encodeURIComponent(token)}`);
    if (!isRecord(result) || !Array.isArray(result.players) || !Array.isArray(result.matches)) return invalidResponse();
    const matches = result.matches.map(migrateMatch).filter(isSharedMatch);
    const players = result.players.map(sharedPlayer).filter((item): item is Player => item !== undefined);
    return {
      company: companyFields(result.group),
      players,
      matches,
      skippedMatches: result.matches.length - matches.length,
      skippedPlayers: result.players.length - players.length,
    };
  }
  async createPlayer(token: string, name: string): Promise<Player> {
    const result = await request(`/api/groups/${encodeURIComponent(token)}/players`, { method: 'POST', body: JSON.stringify({ name }) });
    return isRecord(result) ? player(result.player) : invalidResponse();
  }
  async renamePlayer(token: string, playerId: string, name: string): Promise<Player> {
    const result = await request(`/api/groups/${encodeURIComponent(token)}/players/${encodeURIComponent(playerId)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    return isRecord(result) ? player(result.player) : invalidResponse();
  }
  async resetPlayerStatistics(token: string, playerId: string): Promise<Player> {
    const result = await request(`/api/groups/${encodeURIComponent(token)}/players/${encodeURIComponent(playerId)}/statistics-reset`, { method: 'POST' });
    return isRecord(result) ? player(result.player) : invalidResponse();
  }
  async deletePlayer(token: string, playerId: string): Promise<void> {
    await request(`/api/groups/${encodeURIComponent(token)}/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' });
  }
  async uploadMatch(token: string, match: Match): Promise<void> {
    const body = JSON.stringify(match);
    const bytes = new TextEncoder().encode(body).length;
    if (bytes > MAX_UPLOAD_BYTES)
      // Зеркальная проверка лимита сервера: неустранимая ошибка без бессмысленного запроса.
      throw new HttpError(
        `Матч слишком большой для отправки в компанию (${Math.round(bytes / 1024)} КБ при пределе ${Math.round(MAX_UPLOAD_BYTES / 1024)} КБ).`,
        413,
      );
    await request(`/api/groups/${encodeURIComponent(token)}/matches/${encodeURIComponent(match.id)}`, { method: 'PUT', body });
  }
  async deleteMatch(token: string, matchId: string): Promise<void> {
    await request(`/api/groups/${encodeURIComponent(token)}/matches/${encodeURIComponent(matchId)}`, { method: 'DELETE' });
  }
}
