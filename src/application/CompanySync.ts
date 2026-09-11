import type { Match, Player } from '../domain/match/models';
import { failureReason, isPermanentFailure, type CompanyGateway, type SharedCompany } from './ports/companyGateway';
import type { SharedMatchState } from './ports/repositories';
export type { SharedCompany } from './ports/companyGateway';

type SharedMatchCache = Readonly<{
  token: string;
  match: Match;
  state: SharedMatchState;
  reason?: string;
  attempts?: number;
  failedAt?: string;
}>;
type StateDetails = Readonly<{ reason?: string; attempts?: number; failedAt?: string }>;
type SharedCache = {
  saveCompany(company: SharedCompany): Promise<void>;
  players(token: string): Promise<readonly Player[]>;
  savePlayers(token: string, players: readonly Player[]): Promise<void>;
  /** Чтение-изменение-запись в одной транзакции хранилища. */
  updatePlayers?(token: string, mutate: (current: readonly Player[]) => readonly Player[]): Promise<readonly Player[]>;
  matches(token: string): Promise<readonly SharedMatchCache[]>;
  mergeRemote(token: string, matches: readonly Match[]): Promise<void>;
  setState(token: string, matchId: string, state: SharedMatchState, details?: StateDetails): Promise<void>;
  /** Забыть матч локально (обе копии) и поставить надгробие против воскрешения. */
  forgetMatch?(token: string, matchId: string): Promise<void>;
};

/** Сколько выгрузок идёт одновременно: последовательный цикл на мобильной сети стоит десятки секунд. */
export const UPLOAD_CONCURRENCY = 3;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

const retryDelay = (attempts: number): number =>
  Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);

export class CompanySync {
  /** Все мутации компании выстроены в одну очередь: иначе они теряют правки друг друга. */
  private mutations: Promise<unknown> = Promise.resolve();
  private syncing: Promise<void> | undefined;

  constructor(
    private readonly cache: SharedCache,
    private readonly gateway: CompanyGateway,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation);
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async mutatePlayers(token: string, mutate: (current: readonly Player[]) => readonly Player[]): Promise<void> {
    if (this.cache.updatePlayers) { await this.cache.updatePlayers(token, mutate); return; }
    await this.cache.savePlayers(token, mutate(await this.cache.players(token)));
  }

  async create(name: string): Promise<SharedCompany> {
    const company = await this.gateway.createCompany(name);
    await this.enqueue(() => this.cache.saveCompany(company));
    return company;
  }
  async open(token: string): Promise<SharedCompany> {
    const result = await this.gateway.loadCompany(token);
    const company = { token, ...result.company };
    return this.enqueue(async () => {
      await this.cache.saveCompany(company);
      await this.cache.savePlayers(token, result.players);
      await this.cache.mergeRemote(token, result.matches);
      return company;
    });
  }
  async addPlayer(token: string, name: string): Promise<Player> {
    const player = await this.gateway.createPlayer(token, name);
    await this.enqueue(() => this.mutatePlayers(token, (current) =>
      current.some((item) => item.id === player.id) ? current : [...current, player]));
    return player;
  }
  async renamePlayer(token: string, playerId: string, name: string): Promise<Player> {
    const player = await this.gateway.renamePlayer(token, playerId, name);
    await this.enqueue(() => this.mutatePlayers(token, (current) => current.map((item) => item.id === player.id ? player : item)));
    return player;
  }
  async resetPlayerStatistics(token: string, playerId: string): Promise<Player> {
    const player = await this.gateway.resetPlayerStatistics(token, playerId);
    await this.enqueue(() => this.mutatePlayers(token, (current) => current.map((item) => item.id === player.id ? player : item)));
    return player;
  }
  async deletePlayer(token: string, playerId: string): Promise<void> {
    await this.gateway.deletePlayer(token, playerId);
    await this.enqueue(() => this.mutatePlayers(token, (current) => current.filter((item) => item.id !== playerId)));
  }
  /** Удаляет матч на сервере и обе локальные копии, ставя надгробие: воскрешать его нельзя. */
  async deleteMatch(token: string, matchId: string): Promise<void> {
    await this.gateway.deleteMatch(token, matchId);
    await this.enqueue(async () => {
      if (this.cache.forgetMatch) await this.cache.forgetMatch(token, matchId);
      const result = await this.gateway.loadCompany(token);
      await this.cache.savePlayers(token, result.players);
      await this.cache.mergeRemote(token, result.matches);
    });
  }

  async sync(token: string): Promise<void> {
    // Защита от повторного входа: открытие компании и событие online иначе удваивают трафик.
    if (this.syncing) return this.syncing;
    const running = this.enqueue(() => this.runSync(token));
    this.syncing = running;
    try { await running; } finally { this.syncing = undefined; }
  }

  private dueForUpload(item: SharedMatchCache, at: number): boolean {
    if (item.state === 'synced' || item.state === 'rejected') return false;
    if (item.state !== 'error' || !item.failedAt) return true;
    const failedAt = Date.parse(item.failedAt);
    if (!Number.isFinite(failedAt)) return true;
    return at - failedAt >= retryDelay(item.attempts ?? 1);
  }

  private async upload(token: string, item: SharedMatchCache): Promise<void> {
    try {
      await this.gateway.uploadMatch(token, item.match);
      await this.cache.setState(token, item.match.id, 'synced', { attempts: 0 });
    } catch (cause) {
      if (isPermanentFailure(cause)) {
        // Неустранимый отказ (413, 400, 403…): бесконечные повторы ничего не изменят.
        await this.cache.setState(token, item.match.id, 'rejected', { reason: failureReason(cause), failedAt: this.now() });
        return;
      }
      await this.cache.setState(token, item.match.id, 'error', {
        reason: failureReason(cause),
        attempts: (item.attempts ?? 0) + 1,
        failedAt: this.now(),
      });
    }
  }

  private async runSync(token: string): Promise<void> {
    const at = Date.parse(this.now());
    const pending = (await this.cache.matches(token)).filter((item) => this.dueForUpload(item, Number.isFinite(at) ? at : Date.now()));
    const queue = [...pending];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await this.upload(token, item);
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(queue.length, 1)) }, worker));
    const result = await this.gateway.loadCompany(token);
    await this.cache.savePlayers(token, result.players);
    await this.cache.mergeRemote(token, result.matches);
  }
}
