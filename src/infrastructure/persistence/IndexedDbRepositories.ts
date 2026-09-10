import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Match, Player } from "../../domain/match/models";
import type {
  ActiveMatchRecord,
  ActiveVisitDraft,
  MatchRepository,
  PlayerRepository,
  SettingsRepository,
  BackupRepository,
  BackupData,
} from "../../application/ports/repositories";
import { emptyDraft, type VisitDraft } from "../../domain/match/VisitDraft";
import { scoreOf, type DartThrow } from "../../domain/darts/DartThrow";
import { isReachableThreeDartScore } from '../../domain/match/aggregateScore';
import type { SharedCompany } from '../../application/ports/companyGateway';

interface DartsDb extends DBSchema {
  matches: { key: string; value: Match };
  players: { key: string; value: Player };
  meta: { key: string; value: unknown };
}
let database: Promise<IDBPDatabase<DartsDb>> | undefined;
const db = (): Promise<IDBPDatabase<DartsDb>> =>
  (database ??= openDB<DartsDb>("dart-scorekeeper", 1, {
    upgrade(store) {
      if (!store.objectStoreNames.contains("matches"))
        store.createObjectStore("matches", { keyPath: "id" });
      if (!store.objectStoreNames.contains("players"))
        store.createObjectStore("players", { keyPath: "id" });
      if (!store.objectStoreNames.contains("meta"))
        store.createObjectStore("meta");
    },
  }));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
function isDart(value: unknown): value is DartThrow {
  if (!isRecord(value) || !isString(value.kind)) return false;
  if (["miss", "bull", "outer_bull"].includes(value.kind)) return hasOnlyKeys(value, ["kind"]);
  return value.kind === "number" && hasOnlyKeys(value, ["kind", "segment", "multiplier"])
    && isInteger(value.segment) && value.segment >= 1 && value.segment <= 20
    && (value.multiplier === 1 || value.multiplier === 2 || value.multiplier === 3);
}
function isPlayerNumberRecord(value: unknown, players: readonly string[], minimum: number): boolean {
  return isRecord(value) && players.every(playerId => {
    const score = value[playerId];
    return isInteger(score) && score >= minimum;
  });
}
function isVisitContext(value: unknown, players: readonly string[]): boolean {
  return isRecord(value) && isPlayerNumberRecord(value.scores, players, 0)
    && isInteger(value.currentPlayerIndex) && value.currentPlayerIndex >= 0 && value.currentPlayerIndex < players.length;
}
function isVisit(value: unknown, matchId: string, players: readonly string[]): boolean {
  if (!isRecord(value) || !isString(value.id) || value.matchId !== matchId || !isString(value.playerId) || !players.includes(value.playerId)
    || !isInteger(value.visitIndex) || value.visitIndex < 0 || !isInteger(value.physicalDartsUsed) || !isInteger(value.rawScore) || value.rawScore < 0
    || !isInteger(value.awardedScore) || value.awardedScore < 0 || !isVisitContext(value.before, players) || !isVisitContext(value.after, players)
    || !["scored", "bust", "match_won", "tie_pending"].includes(String(value.result)) || !isString(value.timestamp)) return false;
  if (value.inputKind === 'aggregate') return value.physicalDartsUsed === 3 && isInteger(value.aggregateScore)
    && value.aggregateScore === value.rawScore && isReachableThreeDartScore(value.aggregateScore)
    && value.darts === undefined;
  return (value.inputKind === undefined || value.inputKind === 'detailed') && Array.isArray(value.darts)
    && value.darts.length <= 3 && value.darts.every(isDart) && value.physicalDartsUsed === value.darts.length
    && value.rawScore === value.darts.reduce((total, dart) => total + scoreOf(dart), 0);
}
function isX01Phase(value: unknown, players: readonly string[]): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "regulation") return true;
  if (value.kind !== "awaiting_tie_break" && value.kind !== "tie_break") return false;
  const playerIds = value.playerIds;
  if (!isStringArray(playerIds) || playerIds.length < 2 || new Set(playerIds).size !== playerIds.length || !playerIds.every(id => players.includes(id)) || !Number.isInteger(value.round) || Number(value.round) < 1) return false;
  if (value.kind === "awaiting_tie_break") return hasOnlyKeys(value, ["kind", "playerIds", "round"]);
  return isStringArray(value.completedPlayerIds) && new Set(value.completedPlayerIds).size === value.completedPlayerIds.length
    && value.completedPlayerIds.every(id => playerIds.includes(id)) && isRecord(value.roundScores)
    && Object.entries(value.roundScores).every(([id, score]) => playerIds.includes(id) && isInteger(score) && score >= 0)
    && hasOnlyKeys(value, ["kind", "playerIds", "completedPlayerIds", "roundScores", "round"]);
}
function isFixedVisitsPhase(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "regulation") return hasOnlyKeys(value, ["kind"]);
  return ["awaiting_tie_decision", "extra_round", "completed_draw"].includes(String(value.kind))
    && isInteger(value.round) && value.round >= 1
    && hasOnlyKeys(value, ["kind", "round"]);
}
function isMatch(value: unknown): value is Match {
  if (!isRecord(value) || !isString(value.id) || !isString(value.createdAt) || !["in_progress","completed","abandoned"].includes(String(value.status)) || !isStringArray(value.players) || value.players.length < 2 || new Set(value.players).size !== value.players.length || !isInteger(value.startingPlayerIndex) || value.startingPlayerIndex < 0 || value.startingPlayerIndex >= value.players.length || !isInteger(value.currentPlayerIndex) || value.currentPlayerIndex < 0 || value.currentPlayerIndex >= value.players.length || !isRecord(value.participantNames) || !Array.isArray(value.confirmedVisits) || !isRecord(value.state)) return false;
  const matchId = value.id, players = value.players, participantNames = value.participantNames;
  if (!players.every(id => isString(participantNames[id]))) return false;
  if (value.winnerId !== undefined && (!isString(value.winnerId) || !players.includes(value.winnerId))) return false;
  if (value.status !== "in_progress" && !isString(value.completedAt)) return false;
  if (!value.confirmedVisits.every((visit) => isVisit(visit, matchId, players))) return false;
  if (value.state.kind === "x01") {
    if ((value.state.startingScore !== 301 && value.state.startingScore !== 501 && value.state.startingScore !== 701) || (value.state.outRule !== 'straight' && value.state.outRule !== 'double') || !isRecord(value.state.format) || !isPlayerNumberRecord(value.state.remaining, value.players, 0) || !isPlayerNumberRecord(value.state.visitsCompleted, value.players, 0) || !isX01Phase(value.state.phase, value.players)) return false;
    return value.state.format.kind === "unlimited" || (value.state.format.kind === "limited" && Number.isInteger(value.state.format.visitsPerPlayer) && Number(value.state.format.visitsPerPlayer) >= 1 && Number(value.state.format.visitsPerPlayer) <= 999);
  }
  return value.state.kind === "fixed_visits" && isInteger(value.state.visitsPerPlayer) && value.state.visitsPerPlayer >= 1 && isPlayerNumberRecord(value.state.totals, value.players, 0) && isPlayerNumberRecord(value.state.regulationCompleted, value.players, 0) && isInteger(value.state.extraRoundsCompleted) && value.state.extraRoundsCompleted >= 0 && isFixedVisitsPhase(value.state.phase);
}
function isPlayer(value: unknown): value is Player {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.createdAt);
}
function isSettings(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
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
  current: Match;
  previous?: Match;
  draft?: unknown;
  companyToken?: string;
}>;
function isActiveMatchEnvelope(value: unknown): value is StoredActive {
  return isRecord(value) && isMatch(value.current) && (value.previous === undefined || isMatch(value.previous));
}
function migrateMatch(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.state)) return value;
  const state = value.state.kind === 'x01'
    ? { ...value.state, startingScore: value.state.startingScore ?? 501, outRule: value.state.outRule ?? 'straight' }
    : value.state;
  const confirmedVisits = Array.isArray(value.confirmedVisits)
    ? value.confirmedVisits.map((visit) => isRecord(visit) && visit.inputKind === undefined ? { ...visit, inputKind: 'detailed' } : visit)
    : value.confirmedVisits;
  return { ...value, state, confirmedVisits };
}
function migrateActive(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { ...value, current: migrateMatch(value.current), ...(value.previous !== undefined ? { previous: migrateMatch(value.previous) } : {}) };
}
function emptyActiveDraft(match: Match): ActiveVisitDraft {
  return { playerId: match.players[match.currentPlayerIndex]!, draft: emptyDraft() };
}

export class IndexedDbMatchRepository implements MatchRepository {
  async saveActive(record: ActiveMatchRecord): Promise<void> {
    await (await db()).put(
      "meta",
      structuredClone({
        schemaVersion: 3,
        current: record.current,
        ...(record.previous ? { previous: record.previous } : {}),
      draft: record.draft,
        ...(record.companyToken ? { companyToken: record.companyToken } : {}),
      }),
      "activeMatch",
    );
  }
  async loadActive(): Promise<ActiveMatchRecord | undefined> {
    const stored = await (await db()).get("meta", "activeMatch");
    if (stored === undefined) return undefined;
    if (!isRecord(stored) || (stored.schemaVersion !== undefined && stored.schemaVersion !== 1 && stored.schemaVersion !== 2 && stored.schemaVersion !== 3))
      throw new Error("Сохранённый матч имеет неподдерживаемую версию.");
    const value = migrateActive(stored);
    if (!isActiveMatchEnvelope(value))
      throw new Error("Сохранённый матч повреждён. Сбросьте локальные данные.");
    const base = value.previous === undefined
      ? { current: value.current }
      : { current: value.current, previous: value.previous };
    if ((value.schemaVersion === 2 || value.schemaVersion === 3) && isActiveDraft(value.draft, value.current))
      return { ...base, draft: value.draft, ...(isString(value.companyToken) ? { companyToken: value.companyToken } : {}) };
    return {
      ...base,
      draft: emptyActiveDraft(value.current),
      draftRecovery: value.schemaVersion === 2 || value.schemaVersion === 3 ? "discarded_corrupt" : "missing_legacy",
    };
  }
  async archiveAndClearActive(match: Match): Promise<void> {
    const database = await db();
    const transaction = database.transaction(["matches", "meta"], "readwrite");
    await transaction.objectStore("matches").put(structuredClone(match));
    const active = await transaction.objectStore('meta').get('activeMatch') as StoredActive | undefined;
    if (active?.companyToken && match.status !== 'in_progress') {
      const key = `match:${active.companyToken}:${match.id}`;
      await transaction.objectStore('meta').put(structuredClone({ token: active.companyToken, match, state: 'pending' }), key);
    }
    await transaction.objectStore("meta").delete("activeMatch");
    await transaction.done;
  }
  async listHistory(): Promise<readonly Match[]> {
    const values = (await (await db()).getAll("matches")).map(migrateMatch);
    return values
      .filter(isMatch)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
}

export type SharedMatchCache = Readonly<{ token: string; match: Match; state: 'pending' | 'synced' | 'error' }>;
export class IndexedDbSharedRepository {
  async companies(): Promise<readonly SharedCompany[]> {
    return (await (await db()).getAll('meta')).filter((x): x is SharedCompany => isRecord(x) && x.kind === 'company' && isString(x.token) && typeof x.name === 'string' && isString(x.createdAt));
  }
  async saveCompany(company: SharedCompany): Promise<void> { await (await db()).put('meta', { ...company, kind: 'company' }, `company:${company.token}`); }
  async players(token: string): Promise<readonly Player[]> {
    const value = await (await db()).get('meta', `players:${token}`);
    return Array.isArray(value) ? value.filter(isPlayer) : [];
  }
  async savePlayers(token: string, players: readonly Player[]): Promise<void> { await (await db()).put('meta', structuredClone(players), `players:${token}`); }
  async matches(token: string): Promise<readonly SharedMatchCache[]> {
    const all = await (await db()).getAll('meta');
    return all.filter((x): x is SharedMatchCache => isRecord(x) && x.token === token && isMatch(x.match) && ['pending','synced','error'].includes(String(x.state)));
  }
  async mergeRemote(token: string, matches: readonly Match[]): Promise<void> {
    const database = await db(); const tx = database.transaction('meta', 'readwrite');
    for (const match of matches) {
      if (!isMatch(match) || match.status === 'in_progress') continue;
      const key = `match:${token}:${match.id}`; const existing = await tx.store.get(key) as SharedMatchCache | undefined;
      await tx.store.put({ token, match: structuredClone(match), state: existing?.state === 'pending' ? 'pending' : 'synced' }, key);
    } await tx.done;
  }
  async setState(token: string, matchId: string, state: SharedMatchCache['state']): Promise<void> {
    const database = await db(); const key = `match:${token}:${matchId}`; const current = await database.get('meta', key) as SharedMatchCache | undefined;
    if (current) await database.put('meta', { ...current, state }, key);
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
export class IndexedDbBackupRepository implements BackupRepository {
  async readAll(): Promise<BackupData> {
    const database = await db();
    const [players, matches, active, settings] = await Promise.all([
      database.getAll('players'), database.getAll('matches'), database.get('meta', 'activeMatch'), database.get('meta', 'settings'),
    ]);
    const migratedActive = active === undefined ? undefined : migrateActive(active);
    if (migratedActive !== undefined && !isActiveMatchEnvelope(migratedActive)) throw new Error('Активный матч повреждён.');
    const validMatches = matches.map(migrateMatch);
    if (!players.every(isPlayer) || !validMatches.every(isMatch) || !isSettings(settings ?? {})) throw new Error('Локальные данные повреждены.');
    const activeRecord = migratedActive === undefined ? undefined : (() => {
      const envelope = migratedActive as StoredActive;
      if (!isActiveDraft(envelope.draft, envelope.current)) throw new Error('Активный подход повреждён.');
      return envelope.previous ? { current: envelope.current, previous: envelope.previous, draft: envelope.draft } : { current: envelope.current, draft: envelope.draft };
    })();
    return { players, matches: validMatches as Match[], ...(activeRecord ? { active: activeRecord } : {}), settings: (settings ?? {}) as Record<string,string> };
  }
  async replaceAll(data: BackupData): Promise<void> {
    if (!isRecord(data) || !Array.isArray(data.players) || !data.players.every(isPlayer) || !Array.isArray(data.matches)) throw new Error('Резервная копия повреждена.');
    const matches = data.matches.map(migrateMatch);
    if (!matches.every(isMatch) || !isSettings(data.settings)) throw new Error('Резервная копия содержит некорректные данные.');
    let activeEnvelope: StoredActive | undefined;
    if (data.active !== undefined) {
      if (!isRecord(data.active)) throw new Error('Активный матч в копии повреждён.');
      const candidate = migrateActive({ schemaVersion: 3, ...data.active });
      if (!isActiveMatchEnvelope(candidate) || !isActiveDraft(candidate.draft, candidate.current)) throw new Error('Активный матч в копии повреждён.');
      activeEnvelope = candidate;
    }
    const database = await db();
    const transaction = database.transaction(['players', 'matches', 'meta'], 'readwrite');
    await transaction.objectStore('players').clear();
    await transaction.objectStore('matches').clear();
    await transaction.objectStore('meta').delete('activeMatch');
    await transaction.objectStore('meta').put(structuredClone(data.settings), 'settings');
    for (const player of data.players) await transaction.objectStore('players').put(structuredClone(player));
    for (const match of matches as Match[]) await transaction.objectStore('matches').put(structuredClone(match));
    if (activeEnvelope) await transaction.objectStore('meta').put(structuredClone(activeEnvelope), 'activeMatch');
    await transaction.done;
  }
}
export async function clearLocalData(): Promise<void> {
  if (database) {
    (await database).close();
    database = undefined;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("dart-scorekeeper");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Не удалось закрыть локальную базу данных."));
  });
  localStorage.removeItem("darts-settings-v1");
}
