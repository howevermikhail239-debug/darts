import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanySync, SharedCompany } from "../../application/CompanySync";
import type { Match, Player } from "../../domain/match/models";
import { networkMessage } from "../errors/userMessage";
import type { SharedMatchState } from "../../application/ports/repositories";

type SharedMatch = Readonly<{
  match: Match;
  state: SharedMatchState;
}>;

type SharedCache = Readonly<{
  companies(): Promise<readonly SharedCompany[]>;
  players(token: string): Promise<readonly Player[]>;
  matches(token: string): Promise<readonly SharedMatch[]>;
}>;

type Dependencies = Readonly<{
  sync: CompanySync;
  cache: SharedCache;
}>;

const offlineNote = "Нет связи. Матч сохранится и отправится позже.";

function tokenFromPath(): string | undefined {
  return /^\/g\/([^/]+)$/.exec(location.pathname)?.[1];
}

/** Меняет путь, сохраняя состояние истории экранов (см. `useScreenHistory`). */
function replacePath(path: string): void {
  const state = window.history.state as unknown;
  window.history.replaceState(state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : null, "", path);
}

export const companyInviteLink = (token: string): string => `${location.origin}/g/${token}`;

export function useCompanySync({ sync, cache }: Dependencies) {
  const [activeToken, setActiveToken] = useState(tokenFromPath);
  const currentToken = useRef(activeToken);
  const generation = useRef(0);
  const [loading, setLoading] = useState(Boolean(activeToken));
  const [company, setCompany] = useState<SharedCompany>();
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [history, setHistory] = useState<readonly Match[]>([]);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  // Отказ локального хранилища — отдельная, фатальная категория (DATA-4).
  const [storageError, setStorageError] = useState<string>();
  const [knownCompanies, setKnownCompanies] = useState<readonly SharedCompany[]>([]);
  const [catalogRevision, setCatalogRevision] = useState(0);

  // Список компаний, которые устройство уже знает (DATA-6): без него выход из
  // компании необратим, потому что токен существует только в адресной строке.
  useEffect(() => {
    let alive = true;
    void cache.companies()
      .then((list) => { if (alive) setKnownCompanies(list); })
      .catch(() => { if (alive) setKnownCompanies([]); });
    return () => { alive = false; };
  }, [cache, catalogRevision]);

  const applyCache = useCallback(async (token: string, expectedGeneration: number) => {
    const [nextPlayers, matches] = await Promise.all([
      cache.players(token),
      cache.matches(token),
    ]);
    if (currentToken.current !== token || generation.current !== expectedGeneration) return;
    setPlayers(nextPlayers);
    setHistory(matches.map((item) => item.match));
    setNote(matches.some((item) => item.state !== "synced") ? "Матч ожидает отправки." : "Все матчи синхронизированы");
  }, [cache]);

  const retry = useCallback(async () => {
    const token = currentToken.current;
    if (!token) return;
    const expectedGeneration = generation.current;
    try {
      await sync.sync(token);
      await applyCache(token, expectedGeneration);
    } catch {
      if (currentToken.current === token && generation.current === expectedGeneration) setNote(offlineNote);
    }
  }, [applyCache, sync]);

  useEffect(() => {
    const token = activeToken;
    if (!token) return;
    const expectedGeneration = ++generation.current;
    currentToken.current = token;
    let active = true;
    void (async () => {
      const [cachedCompanies, cachedPlayers, cachedMatches] = await Promise.all([
        cache.companies(),
        cache.players(token),
        cache.matches(token),
      ]);
      const known = cachedCompanies.find((item) => item.token === token);
      if (!active || generation.current !== expectedGeneration) return;
      if (known) {
        setCompany(known);
        setPlayers(cachedPlayers);
        setHistory(cachedMatches.map((item) => item.match));
        setNote(cachedMatches.some((item) => item.state !== "synced") ? "Матч ожидает отправки." : "Все матчи синхронизированы");
      }
      try {
        const opened = await sync.open(token);
        if (!active || generation.current !== expectedGeneration) return;
        setCompany(opened);
        if (!known) setCatalogRevision((value) => value + 1);
        await applyCache(token, expectedGeneration);
        if (active && generation.current === expectedGeneration) void retry();
      } catch (cause) {
        if (!active || generation.current !== expectedGeneration) return;
        if (known) setNote(offlineNote);
        else setError(networkMessage(cause, "Компания не найдена или ссылка недействительна."));
      } finally {
        if (active && generation.current === expectedGeneration) setLoading(false);
      }
    })().catch((cause: unknown) => {
      if (active && generation.current === expectedGeneration) {
        console.error("Отказ локального хранилища при открытии компании:", cause);
        setStorageError("Не удалось прочитать данные компании на этом устройстве.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [activeToken, applyCache, cache, retry, sync]);

  useEffect(() => {
    if (!company) return;
    const handleOnline = () => { void retry(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [company, retry]);

  const createCompany = useCallback(async (name: string) => {
    const created = await sync.create(name);
    generation.current += 1;
    currentToken.current = created.token;
    setCompany(created);
    setPlayers([]);
    setHistory([]);
    setNote(undefined);
    setError(undefined);
    setActiveToken(created.token);
    setCatalogRevision((value) => value + 1);
    replacePath(`/g/${created.token}`);
  }, [sync]);

  /**
   * Возврат в уже известную устройству компанию (DATA-6). Перезагрузка страницы
   * не нужна: активный матч живёт в отдельном хуке и не теряется.
   */
  const openCompany = useCallback((token: string) => {
    if (currentToken.current === token) return;
    generation.current += 1;
    currentToken.current = token;
    setCompany(undefined);
    setPlayers([]);
    setHistory([]);
    setNote(undefined);
    setError(undefined);
    setLoading(true);
    setActiveToken(token);
    replacePath(`/g/${token}`);
  }, []);

  const addPlayer = useCallback(async (name: string) => {
    const token = currentToken.current;
    if (!token) throw new Error("Компания не выбрана");
    const player = await sync.addPlayer(token, name);
    if (currentToken.current === token) setPlayers((current) => [...current, player]);
    return player;
  }, [sync]);

  const mutatePlayer = useCallback(async (operation: (token: string) => Promise<Player>) => {
    const token = currentToken.current;
    if (!token || !navigator.onLine) throw new Error("Для изменения данных требуется подключение к серверу.");
    const player = await operation(token);
    setPlayers(await cache.players(token));
    return player;
  }, [cache]);
  const renamePlayer = useCallback((playerId: string, name: string) => mutatePlayer((token) => sync.renamePlayer(token, playerId, name)), [mutatePlayer, sync]);
  const resetPlayerStatistics = useCallback((playerId: string) => mutatePlayer((token) => sync.resetPlayerStatistics(token, playerId)), [mutatePlayer, sync]);
  const deletePlayer = useCallback(async (playerId: string) => {
    const token = currentToken.current;
    if (!token || !navigator.onLine) throw new Error("Для удаления требуется подключение к серверу.");
    await sync.deletePlayer(token, playerId); setPlayers(await cache.players(token));
  }, [cache, sync]);
  const deleteMatch = useCallback(async (matchId: string) => {
    const token = currentToken.current;
    if (!token || !navigator.onLine) throw new Error("Для удаления требуется подключение к серверу.");
    await sync.deleteMatch(token, matchId); await applyCache(token, generation.current);
  }, [applyCache, sync]);

  const leaveCompany = useCallback(() => {
    generation.current += 1;
    currentToken.current = undefined;
    setCompany(undefined);
    setPlayers([]);
    setHistory([]);
    setNote(undefined);
    setError(undefined);
    setLoading(false);
    setActiveToken(undefined);
    setCatalogRevision((value) => value + 1);
    replacePath("/");
  }, []);

  return {
    loading,
    company,
    players,
    history,
    note,
    error,
    storageError,
    knownCompanies,
    inviteLink: company ? companyInviteLink(company.token) : undefined,
    createCompany,
    openCompany,
    addPlayer,
    renamePlayer,
    resetPlayerStatistics,
    deletePlayer,
    deleteMatch,
    leaveCompany,
    retry,
    syncAfterMatch: retry,
  };
}
