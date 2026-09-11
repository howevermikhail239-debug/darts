import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import type { Match, Player } from "../../domain/match/models";
import { isStoredMatch, migrateMatch } from "../../domain/match/validation";
import type {
  ActiveMatchIssue,
  ActiveMatchRecord,
  ActiveVisitDraft,
  ExternalActiveMatchChange,
  MatchRepository,
  PlayerRepository,
  SettingsRepository,
  SharedMatchState,
  BackupRepository,
  BackupData,
  BackupCompanyMatch,
} from "../../application/ports/repositories";
import { emptyDraft, type VisitDraft } from "../../domain/match/VisitDraft";
import { type DartThrow } from "../../domain/darts/DartThrow";
import { isReachableThreeDartScore } from '../../domain/match/aggregateScore';
import type { SharedCompany } from '../../application/ports/companyGateway';
import type { LastSetupRepository, LastSetupTemplate } from '../../application/LastSetup';
import { tabChannel } from '../TabChannel';

const DB_NAME = "dart-scorekeeper";
export const DB_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSION = 3;
export const BLOCKED_MESSAGE = "Закройте другие вкладки приложения: они мешают обновить локальную базу данных.";
export const BLOCKING_MESSAGE = "Приложение открыто в другой вкладке и обновляет локальную базу. Обновите эту страницу.";
export const TERMINATED_MESSAGE = "Соединение с локальной базой данных было прервано браузером.";

export type CompanyMatchRow = Readonly<{
  token: string;
  matchId: string;
  match: Match;
  state: SharedMatchState;
  reason?: string;
  attempts?: number;
  failedAt?: string;
}>;
type CompanyPlayersRow = Readonly<{ token: string; players: readonly Player[] }>;
type DeletedMatchRow = Readonly<{ token: string; matchId: string; deletedAt: string }>;

interface DartsDb extends DBSchema {
  matches: { key: string; value: Match; indexes: { byCreatedAt: string } };
  players: { key: string; value: Player };
  meta: { key: string; value: unknown };
  companies: { key: string; value: SharedCompany };
  companyPlayers: { key: string; value: CompanyPlayersRow };
  companyMatches: { key: [string, string]; value: CompanyMatchRow; indexes: { byToken: string; byTokenState: [string, string] } };
  deletedMatches: { key: [string, string]; value: DeletedMatchRow };
}

type UpgradeTransaction = IDBPTransaction<DartsDb, StoreNames<DartsDb>[], "versionchange">;

type StorageNotice = Readonly<{ kind: "blocked" | "blocking" | "terminated"; message: string }>;
const noticeListeners = new Set<(notice: StorageNotice) => void>();
/** Подписка интерфейса на сообщения хранилища («закройте другие вкладки» и т. п.). */
export function onStorageNotice(listener: (notice: StorageNotice) => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}
function notify(kind: StorageNotice["kind"], message: string): void {
  for (const listener of [...noticeListeners]) listener({ kind, message });
}

/** Перенос записей компании из свалки `meta` в отдельные стор-ы. Идемпотентен. */
async function migrateMetaRows(transaction: UpgradeTransaction): Promise<void> {
  const meta = transaction.objectStore("meta");
  const companies = transaction.objectStore("companies");
  const companyPlayers = transaction.objectStore("companyPlayers");
  const companyMatches = transaction.objectStore("companyMatches");
  for (const rawKey of await meta.getAllKeys()) {
    const key = String(rawKey);
    if (key.startsWith("company:")) {
      const value = await meta.get(rawKey);
      if (isRecord(value) && isString(value.token) && typeof value.name === "string" && isString(value.createdAt))
        await companies.put({ token: value.token, name: value.name, createdAt: value.createdAt });
      await meta.delete(rawKey);
    } else if (key.startsWith("players:")) {
      const token = key.slice("players:".length);
      const value = await meta.get(rawKey);
      if (isString(token) && Array.isArray(value))
        await companyPlayers.put({ token, players: value.filter(isPlayer) });
      await meta.delete(rawKey);
    } else if (key.startsWith("match:")) {
      const value = await meta.get(rawKey);
      const token = isRecord(value) && isString(value.token) ? value.token : key.slice("match:".length).split(":")[0];
      const match = isRecord(value) ? value.match : undefined;
      const state = isRecord(value) && isSharedMatchState(value.state) ? value.state : "pending";
      if (isString(token) && isRecord(match) && isString(match.id))
        await companyMatches.put({ token, matchId: match.id, match: match as unknown as Match, state });
      await meta.delete(rawKey);
    }
  }
}

function upgrade(database: IDBPDatabase<DartsDb>, oldVersion: number, _newVersion: number | null, transaction: UpgradeTransaction): void {
  if (!database.objectStoreNames.contains("matches")) database.createObjectStore("matches", { keyPath: "id" });
  if (!database.objectStoreNames.contains("players")) database.createObjectStore("players", { keyPath: "id" });
  if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta");
  const matches = transaction.objectStore("matches");
  if (!matches.indexNames.contains("byCreatedAt")) matches.createIndex("byCreatedAt", "createdAt");
  if (!database.objectStoreNames.contains("companies")) database.createObjectStore("companies", { keyPath: "token" });
  if (!database.objectStoreNames.contains("companyPlayers")) database.createObjectStore("companyPlayers", { keyPath: "token" });
  if (!database.objectStoreNames.contains("companyMatches")) {
    const store = database.createObjectStore("companyMatches", { keyPath: ["token", "matchId"] });
    store.createIndex("byToken", "token");
    store.createIndex("byTokenState", ["token", "state"]);
  }
  if (!database.objectStoreNames.contains("deletedMatches")) database.createObjectStore("deletedMatches", { keyPath: ["token", "matchId"] });
  if (oldVersion > 0 && oldVersion < 2) void migrateMetaRows(transaction);
}

let database: Promise<IDBPDatabase<DartsDb>> | undefined;
let connection: IDBPDatabase<DartsDb> | undefined;
const db = (): Promise<IDBPDatabase<DartsDb>> => {
  if (!database) {
    database = openDB<DartsDb>(DB_NAME, DB_VERSION, {
      upgrade,
      blocked() { notify("blocked", BLOCKED_MESSAGE); },
      blocking() {
        // Другая вкладка обновляет схему: освобождаем соединение, иначе она зависнет навсегда.
        notify("blocking", BLOCKING_MESSAGE);
        connection?.close();
        connection = undefined;
        database = undefined;
      },
      terminated() {
        notify("terminated", TERMINATED_MESSAGE);
        connection = undefined;
        database = undefined;
      },
    })
      .then((opened) => { connection = opened; return opened; })
      // Отклонённый промис нельзя кэшировать: одна помеха иначе выводит хранилище из строя навсегда.
      .catch((error: unknown) => { database = undefined; connection = undefined; throw error; });
  }
  return database;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
const isSharedMatchState = (value: unknown): value is SharedMatchState =>
  value === "pending" || value === "synced" || value === "error" || value === "rejected";
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
/** Единственный валидатор матча живёт в домене; здесь он только переиспользуется. */
const isMatch = isStoredMatch;
function isDart(value: unknown): value is DartThrow {
  if (!isRecord(value) || !isString(value.kind)) return false;
  if (["miss", "bull", "outer_bull"].includes(value.kind)) return hasOnlyKeys(value, ["kind"]);
  return value.kind === "number" && hasOnlyKeys(value, ["kind", "segment", "multiplier"])
    && isInteger(value.segment) && value.segment >= 1 && value.segment <= 20
    && (value.multiplier === 1 || value.multiplier === 2 || value.multiplier === 3);
}
function isPlayer(value: unknown): value is Player {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.createdAt)
    && (value.statsResetAt === undefined || isString(value.statsResetAt));
}
function isSettings(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}
function isLastSetup(value: unknown): value is LastSetupTemplate {
  if (!isRecord(value) || !Array.isArray(value.participants) || !isRecord(value.setup)) return false;
  if (value.participants.length < 2 || value.participants.length > 8 || !value.participants.every((participant) =>
    isRecord(participant) && isString(participant.name) && (participant.playerId === undefined || isString(participant.playerId)))) return false;
  if (!isInteger(value.setup.startingPlayerIndex) || value.setup.startingPlayerIndex < 0 || value.setup.startingPlayerIndex >= value.participants.length) return false;
  if (value.setup.mode === 'fixed_visits') return isInteger(value.setup.visitsPerPlayer) && value.setup.visitsPerPlayer >= 1 && value.setup.visitsPerPlayer <= 999;
  if (value.setup.mode !== 'x01' || ![301, 501, 701].includes(Number(value.setup.startingScore)) || !['straight', 'double'].includes(String(value.setup.outRule)) || !isRecord(value.setup.format)) return false;
  return value.setup.format.kind === 'unlimited' || (value.setup.format.kind === 'limited' && isInteger(value.setup.format.visitsPerPlayer) && value.setup.format.visitsPerPlayer >= 1 && value.setup.format.visitsPerPlayer <= 999);
}
function isDraft(value: unknown): value is VisitDraft {
  if (!isRecord(value)) return false;
  if (value.kind === 'aggregate') return Array.isArray(value.darts) && value.darts.length === 0
    && (value.score === undefined || (typeof value.score === 'number' && isReachableThreeDartScore(value.score)));
  return (value.kind === undefined || value.kind === 'detailed') && Array.isArray(value.darts) && value.darts.length <= 3 && value.darts.every(isDart);
}
function isActiveDraft(value: unknown, match: Match): value is ActiveVisitDraft {
  return isRecord(value) && typeof value.playerId === "string" && value.playerId === match.players[match.currentPlayerIndex] && isDraft(value.draft);
}
type StoredActive = Readonly<{
  schemaVersion?: number;
  revision?: number;
  current: Match;
  previous?: Match;
  draft?: unknown;
  companyToken?: string;
}>;
function isActiveMatchEnvelope(value: unknown): value is StoredActive {
  return isRecord(value) && isMatch(value.current) && (value.previous === undefined || isMatch(value.previous));
}
function migrateActive(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { ...value, current: migrateMatch(value.current), ...(value.previous !== undefined ? { previous: migrateMatch(value.previous) } : {}) };
}
function emptyActiveDraft(match: Match): ActiveVisitDraft {
  return { playerId: match.players[match.currentPlayerIndex]!, draft: emptyDraft() };
}
/**
 * Поколение хранилища. Меняется при восстановлении из копии и при стирании данных: всё,
 * что вкладка помнила о ревизии активного матча, после этого недействительно.
 */
let storageEpoch = 0;
const bumpStorageEpoch = (): void => { storageEpoch += 1; };

const revisionOf = (value: unknown): number =>
  isRecord(value) && isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;

/** Активный матч изменён другой вкладкой: запись отклонена, чтобы не затереть чужой прогресс. */
export class ActiveMatchConflictError extends Error {
  readonly expectedRevision: number | undefined;
  readonly actualRevision: number;
  constructor(expectedRevision: number | undefined, actualRevision: number) {
    super("Матч изменён в другой вкладке приложения. Обновите страницу, чтобы продолжить.");
    this.name = "ActiveMatchConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class IndexedDbMatchRepository implements MatchRepository {
  /** Ревизия, которую эта вкладка считает актуальной. Отслеживается внутри репозитория,
   *  поэтому сигнатура порта и вызывающий код (GameSession) остаются неизменными. */
  private revision: number | undefined;
  private issue: ActiveMatchIssue | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = storageEpoch;

  /** После восстановления копии или стирания данных ревизия этой вкладки бессмысленна. */
  private syncEpoch(): void {
    if (this.epoch === storageEpoch) return;
    this.epoch = storageEpoch;
    this.revision = undefined;
  }

  /** Признак для интерфейса: запись создана более новой версией приложения. */
  activeMatchIssue(): ActiveMatchIssue | undefined { return this.issue; }
  /** Подписка на изменения активного матча в других вкладках. */
  onExternalChange(listener: (event: ExternalActiveMatchChange) => void): () => void {
    return tabChannel.subscribe(listener);
  }
  /** Ревизия активного матча, известная этой вкладке (для диагностики и тестов). */
  currentRevision(): number | undefined { return this.revision; }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async saveActive(record: ActiveMatchRecord): Promise<void> {
    await this.serialize(async () => {
      this.syncEpoch();
      const store = (await db()).transaction("meta", "readwrite");
      const stored = await store.objectStore("meta").get("activeMatch");
      const actual = revisionOf(stored);
      if (stored !== undefined && this.revision !== undefined && actual !== this.revision) {
        store.abort();
        await store.done.catch(() => undefined);
        throw new ActiveMatchConflictError(this.revision, actual);
      }
      const next = actual + 1;
      await store.objectStore("meta").put(
        structuredClone({
          schemaVersion: SUPPORTED_SCHEMA_VERSION,
          revision: next,
          current: record.current,
          ...(record.previous ? { previous: record.previous } : {}),
          draft: record.draft,
          ...(record.companyToken ? { companyToken: record.companyToken } : {}),
        }),
        "activeMatch",
      );
      await store.done;
      this.revision = next;
      tabChannel.post({ kind: "saved", revision: next, matchId: record.current.id });
    });
  }
  async loadActive(): Promise<ActiveMatchRecord | undefined> {
    this.issue = undefined;
    this.syncEpoch();
    const stored = await (await db()).get("meta", "activeMatch");
    if (stored === undefined) { this.revision = undefined; return undefined; }
    this.revision = revisionOf(stored);
    if (!isRecord(stored)) throw new Error("Сохранённый матч повреждён. Сбросьте локальные данные.");
    const schemaVersion = stored.schemaVersion;
    if (isInteger(schemaVersion) && schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      // Откат на прежнюю версию клиента не должен предлагать стереть данные: история цела,
      // активный матч просто не восстанавливается.
      this.issue = "future_version";
      return undefined;
    }
    if (schemaVersion !== undefined && schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3)
      throw new Error("Сохранённый матч имеет неподдерживаемую версию.");
    const value = migrateActive(stored);
    if (!isActiveMatchEnvelope(value))
      throw new Error("Сохранённый матч повреждён. Сбросьте локальные данные.");
    const base = value.previous === undefined
      ? { current: value.current }
      : { current: value.current, previous: value.previous };
    const revision = this.revision;
    if ((value.schemaVersion === 2 || value.schemaVersion === 3) && isActiveDraft(value.draft, value.current))
      return { ...base, draft: value.draft, revision, ...(isString(value.companyToken) ? { companyToken: value.companyToken } : {}) };
    return {
      ...base,
      draft: emptyActiveDraft(value.current),
      revision,
      draftRecovery: value.schemaVersion === 2 || value.schemaVersion === 3 ? "discarded_corrupt" : "missing_legacy",
    };
  }
  async archiveAndClearActive(match: Match): Promise<void> {
    await this.serialize(async () => {
      const transaction = (await db()).transaction(["matches", "meta", "companyMatches"], "readwrite");
      await transaction.objectStore("matches").put(structuredClone(match));
      const active = await transaction.objectStore('meta').get('activeMatch') as StoredActive | undefined;
      if (active?.companyToken && match.status !== 'in_progress')
        await transaction.objectStore('companyMatches').put(structuredClone({
          token: active.companyToken, matchId: match.id, match, state: 'pending' as const,
        }));
      await transaction.objectStore("meta").delete("activeMatch");
      await transaction.done;
      this.revision = undefined;
      tabChannel.post({ kind: "cleared", revision: 0, matchId: match.id });
    });
  }
  /** История по индексу byCreatedAt (по убыванию). `limit` необязателен: по умолчанию вся история. */
  async listHistory(limit?: number): Promise<readonly Match[]> {
    return (await this.readHistory(limit)).matches;
  }
  /** То же, но с числом пропущенных повреждённых записей — интерфейс может об этом сообщить. */
  async readHistory(limit?: number): Promise<{ matches: readonly Match[]; skipped: number }> {
    const matches: Match[] = [];
    let skipped = 0;
    let cursor = await (await db()).transaction("matches").store.index("byCreatedAt").openCursor(null, "prev");
    while (cursor) {
      const migrated = migrateMatch(cursor.value);
      if (isMatch(migrated)) {
        matches.push(migrated);
        if (limit !== undefined && matches.length >= limit) break;
      } else skipped += 1;
      cursor = await cursor.continue();
    }
    return { matches, skipped };
  }
  async deleteHistory(matchId: string): Promise<boolean> {
    const connected = await db();
    const existing = await connected.get("matches", matchId);
    if (!existing) return false;
    await connected.delete("matches", matchId);
    return true;
  }
}
export class IndexedDbPlayerRepository implements PlayerRepository {
  async list(): Promise<readonly Player[]> {
    return (await (await db()).getAll("players")).sort((a, b) =>
      a.name.localeCompare(b.name, "ru"),
    );
  }
  async save(player: Player): Promise<void> {
    await (await db()).put("players", structuredClone(player));
  }
  async delete(playerId: string): Promise<boolean> {
    const connected = await db();
    const existing = await connected.get("players", playerId);
    if (!existing) return false;
    await connected.delete("players", playerId);
    return true;
  }
}

export type SharedMatchCache = Readonly<{
  token: string;
  matchId: string;
  match: Match;
  state: SharedMatchState;
  reason?: string;
  attempts?: number;
  failedAt?: string;
}>;
export type SharedMatchDetails = Readonly<{ reason?: string; attempts?: number; failedAt?: string }>;

const toCache = (row: CompanyMatchRow): SharedMatchCache | undefined => {
  const match = migrateMatch(row.match);
  if (!isMatch(match) || !isSharedMatchState(row.state)) return undefined;
  return {
    token: row.token, matchId: row.matchId, match, state: row.state,
    ...(isString(row.reason) ? { reason: row.reason } : {}),
    ...(isInteger(row.attempts) ? { attempts: row.attempts } : {}),
    ...(isString(row.failedAt) ? { failedAt: row.failedAt } : {}),
  };
};

export class IndexedDbSharedRepository {
  async companies(): Promise<readonly SharedCompany[]> {
    return (await (await db()).getAll('companies'))
      .filter((value): value is SharedCompany => isRecord(value) && isString(value.token) && typeof value.name === 'string' && isString(value.createdAt));
  }
  async saveCompany(company: SharedCompany): Promise<void> {
    await (await db()).put('companies', { token: company.token, name: company.name, createdAt: company.createdAt });
  }
  async players(token: string): Promise<readonly Player[]> {
    const row = await (await db()).get('companyPlayers', token);
    return Array.isArray(row?.players) ? row.players.filter(isPlayer) : [];
  }
  async savePlayers(token: string, players: readonly Player[]): Promise<void> {
    await (await db()).put('companyPlayers', structuredClone({ token, players: [...players] }));
  }
  /** Чтение-изменение-запись в ОДНОЙ транзакции: иначе параллельные мутации теряют игроков. */
  async updatePlayers(token: string, mutate: (current: readonly Player[]) => readonly Player[]): Promise<readonly Player[]> {
    const transaction = (await db()).transaction('companyPlayers', 'readwrite');
    const row = await transaction.store.get(token);
    const current = Array.isArray(row?.players) ? row.players.filter(isPlayer) : [];
    const next = [...mutate(current)];
    await transaction.store.put(structuredClone({ token, players: next }));
    await transaction.done;
    return next;
  }
  async matches(token: string): Promise<readonly SharedMatchCache[]> {
    const rows = await (await db()).getAllFromIndex('companyMatches', 'byToken', IDBKeyRange.only(token));
    return rows.map(toCache).filter((row): row is SharedMatchCache => row !== undefined);
  }
  /** Очередь на отправку: читается по индексу [token, state], без загрузки всей истории компании. */
  async pendingMatches(token: string): Promise<readonly SharedMatchCache[]> {
    const connected = await db();
    const rows = (await Promise.all((['pending', 'error'] as const).map((state) =>
      connected.getAllFromIndex('companyMatches', 'byTokenState', IDBKeyRange.only([token, state]))))).flat();
    return rows.map(toCache).filter((row): row is SharedMatchCache => row !== undefined);
  }
  async mergeRemote(token: string, matches: readonly Match[]): Promise<void> {
    const transaction = (await db()).transaction(['companyMatches', 'deletedMatches'], 'readwrite');
    const cached = transaction.objectStore('companyMatches');
    const tombstones = transaction.objectStore('deletedMatches');
    const remoteIds = new Set(matches.map((match) => match.id));
    const deletedIds = new Set((await tombstones.getAll(IDBKeyRange.bound([token, ''], [token, '￿']))).map((row) => row.matchId));
    let cursor = await cached.index('byToken').openCursor(IDBKeyRange.only(token));
    while (cursor) {
      const row = cursor.value;
      const removedRemotely = !remoteIds.has(row.matchId) && row.state === 'synced';
      if (removedRemotely || deletedIds.has(row.matchId)) await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const match of matches) {
      if (!isMatch(match) || match.status === 'in_progress' || deletedIds.has(match.id)) continue;
      const existing = await cached.get([token, match.id]);
      await cached.put(structuredClone({
        token, matchId: match.id, match,
        state: existing?.state === 'pending' ? 'pending' as const : 'synced' as const,
      }));
    }
    // Удаление подтверждено сервером — надгробие больше не нужно.
    for (const matchId of deletedIds) if (!remoteIds.has(matchId)) await tombstones.delete([token, matchId]);
    await transaction.done;
  }
  async setState(token: string, matchId: string, state: SharedMatchState, details: SharedMatchDetails = {}): Promise<void> {
    const transaction = (await db()).transaction('companyMatches', 'readwrite');
    const current = await transaction.store.get([token, matchId]);
    if (current) await transaction.store.put(structuredClone({
      ...current,
      state,
      ...(details.reason !== undefined ? { reason: details.reason } : {}),
      ...(details.attempts !== undefined ? { attempts: details.attempts } : {}),
      ...(details.failedAt !== undefined ? { failedAt: details.failedAt } : {}),
    }));
    await transaction.done;
  }
  /** Явное удаление матча компании: обе локальные копии плюс надгробие против воскрешения. */
  async forgetMatch(token: string, matchId: string, deletedAt: string = new Date().toISOString()): Promise<void> {
    const transaction = (await db()).transaction(['companyMatches', 'deletedMatches', 'matches'], 'readwrite');
    await transaction.objectStore('companyMatches').delete([token, matchId]);
    await transaction.objectStore('deletedMatches').put({ token, matchId, deletedAt });
    await transaction.objectStore('matches').delete(matchId);
    await transaction.done;
  }
  /** Идентификаторы явно удалённых матчей компании (надгробия). */
  async deletedMatchIds(token: string): Promise<readonly string[]> {
    const rows = await (await db()).getAll('deletedMatches', IDBKeyRange.bound([token, ''], [token, '￿']));
    return rows.map((row) => row.matchId);
  }
}
export class LocalSettingsRepository implements SettingsRepository {
  async load(): Promise<Readonly<Record<string, string>>> {
    const stored = await (await db()).get('meta', 'settings');
    if (isSettings(stored)) return stored;
    try { const legacy: unknown = JSON.parse(localStorage.getItem('darts-settings-v1') ?? '{}'); return isSettings(legacy) ? legacy : {}; } catch { return {}; }
  }
  async save(values: Readonly<Record<string, string>>): Promise<void> {
    await (await db()).put('meta', structuredClone(values), 'settings');
  }
}
export class IndexedDbLastSetupRepository implements LastSetupRepository {
  async load(context: string): Promise<LastSetupTemplate | undefined> {
    const value = await (await db()).get('meta', `lastSetup:${context}`);
    return isLastSetup(value) ? structuredClone(value) : undefined;
  }
  async save(context: string, template: LastSetupTemplate): Promise<void> {
    await (await db()).put('meta', structuredClone(template), `lastSetup:${context}`);
  }
}
export class IndexedDbBackupRepository implements BackupRepository {
  async readAll(): Promise<BackupData> {
    const connected = await db();
    const [players, matches, active, settings, companies, companyPlayerRows, companyMatchRows, metaKeys] = await Promise.all([
      connected.getAll('players'), connected.getAll('matches'), connected.get('meta', 'activeMatch'), connected.get('meta', 'settings'),
      connected.getAll('companies'), connected.getAll('companyPlayers'), connected.getAll('companyMatches'), connected.getAllKeys('meta'),
    ]);
    const migratedActive = active === undefined ? undefined : migrateActive(active);
    if (migratedActive !== undefined && !isActiveMatchEnvelope(migratedActive)) throw new Error('Активный матч повреждён.');
    const validMatches = matches.map(migrateMatch);
    if (!players.every(isPlayer) || !validMatches.every(isMatch) || !isSettings(settings ?? {})) throw new Error('Локальные данные повреждены.');
    const activeRecord = migratedActive === undefined ? undefined : (() => {
      const envelope = migratedActive as StoredActive;
      if (!isActiveDraft(envelope.draft, envelope.current)) throw new Error('Активный подход повреждён.');
      return {
        current: envelope.current,
        ...(envelope.previous ? { previous: envelope.previous } : {}),
        draft: envelope.draft,
        ...(isString(envelope.companyToken) ? { companyToken: envelope.companyToken } : {}),
      };
    })();
    const lastSetups = (await Promise.all(metaKeys
      .filter((key) => String(key).startsWith('lastSetup:'))
      .map(async (key) => {
        const template = await connected.get('meta', key);
        return isLastSetup(template) ? { context: String(key).slice('lastSetup:'.length), template } : undefined;
      }))).filter((row): row is { context: string; template: LastSetupTemplate } => row !== undefined);
    const companyMatches = companyMatchRows
      .map((row) => {
        const match = migrateMatch(row.match);
        return isMatch(match) && isString(row.token) && isString(row.matchId) && isSharedMatchState(row.state)
          ? { token: row.token, matchId: row.matchId, match, state: row.state, ...(isString(row.reason) ? { reason: row.reason } : {}) }
          : undefined;
      })
      .filter((row): row is BackupCompanyMatch => row !== undefined);
    return {
      players,
      matches: validMatches as Match[],
      ...(activeRecord ? { active: activeRecord } : {}),
      settings: (settings ?? {}) as Record<string, string>,
      companies: companies.filter((company): company is SharedCompany => isRecord(company) && isString(company.token) && typeof company.name === 'string' && isString(company.createdAt)),
      companyPlayers: companyPlayerRows
        .filter((row) => isString(row.token) && Array.isArray(row.players))
        .map((row) => ({ token: row.token, players: row.players.filter(isPlayer) })),
      companyMatches,
      lastSetups,
    };
  }
  async replaceAll(data: BackupData): Promise<void> {
    if (!isRecord(data) || !Array.isArray(data.players) || !data.players.every(isPlayer) || !Array.isArray(data.matches)) throw new Error('Резервная копия повреждена.');
    const matches = data.matches.map(migrateMatch);
    if (!matches.every(isMatch) || !isSettings(data.settings)) throw new Error('Резервная копия содержит некорректные данные.');
    let activeEnvelope: StoredActive | undefined;
    if (data.active !== undefined) {
      if (!isRecord(data.active)) throw new Error('Активный матч в копии повреждён.');
      const candidate = migrateActive({ schemaVersion: SUPPORTED_SCHEMA_VERSION, revision: 1, ...data.active });
      if (!isActiveMatchEnvelope(candidate) || !isActiveDraft(candidate.draft, candidate.current)) throw new Error('Активный матч в копии повреждён.');
      activeEnvelope = candidate;
    }
    const companies = (data.companies ?? []).filter((company) => isRecord(company) && isString(company.token) && typeof company.name === 'string' && isString(company.createdAt));
    const companyPlayers = (data.companyPlayers ?? []).filter((row) => isRecord(row) && isString(row.token) && Array.isArray(row.players));
    const companyMatches = (data.companyMatches ?? [])
      .map((row) => isRecord(row) && isString(row.token) && isString(row.matchId) ? { row, match: migrateMatch(row.match) } : undefined)
      .filter((item): item is { row: BackupCompanyMatch; match: unknown } => item !== undefined && isMatch(item.match));
    const lastSetups = (data.lastSetups ?? []).filter((row) => isRecord(row) && isString(row.context) && isLastSetup(row.template));
    const connected = await db();
    const transaction = connected.transaction(['players', 'matches', 'meta', 'companies', 'companyPlayers', 'companyMatches', 'deletedMatches'], 'readwrite');
    await transaction.objectStore('players').clear();
    await transaction.objectStore('matches').clear();
    await transaction.objectStore('companies').clear();
    await transaction.objectStore('companyPlayers').clear();
    await transaction.objectStore('companyMatches').clear();
    await transaction.objectStore('deletedMatches').clear();
    const meta = transaction.objectStore('meta');
    await meta.delete('activeMatch');
    for (const key of await meta.getAllKeys()) if (String(key).startsWith('lastSetup:')) await meta.delete(key);
    await meta.put(structuredClone(data.settings), 'settings');
    for (const player of data.players) await transaction.objectStore('players').put(structuredClone(player));
    for (const match of matches as Match[]) await transaction.objectStore('matches').put(structuredClone(match));
    for (const company of companies) await transaction.objectStore('companies').put(structuredClone({ token: company.token, name: company.name, createdAt: company.createdAt }));
    for (const row of companyPlayers) await transaction.objectStore('companyPlayers').put(structuredClone({ token: row.token, players: row.players.filter(isPlayer) }));
    for (const { row, match } of companyMatches) await transaction.objectStore('companyMatches').put(structuredClone({
      token: row.token, matchId: row.matchId, match: match as Match,
      state: isSharedMatchState(row.state) ? row.state : 'pending' as const,
      ...(isString(row.reason) ? { reason: row.reason } : {}),
    }));
    for (const row of lastSetups) await meta.put(structuredClone(row.template), `lastSetup:${row.context}`);
    if (activeEnvelope) await meta.put(structuredClone(activeEnvelope), 'activeMatch');
    await transaction.done;
    bumpStorageEpoch();
  }
}
export async function clearLocalData(): Promise<void> {
  bumpStorageEpoch();
  if (database) {
    await database.then((opened) => opened.close()).catch(() => undefined);
    database = undefined;
    connection = undefined;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Не удалось закрыть локальную базу данных."));
  });
  localStorage.removeItem("darts-settings-v1");
}
