import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanySync, SharedCompany } from "../../application/CompanySync";
import type { Match, Player } from "../../domain/match/models";

type SharedMatch = Readonly<{
  match: Match;
  state: "pending" | "synced" | "error";
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

export function useCompanySync({ sync, cache }: Dependencies) {
  const [initialToken] = useState(tokenFromPath);
  const currentToken = useRef(initialToken);
  const generation = useRef(0);
  const [loading, setLoading] = useState(Boolean(initialToken));
  const [company, setCompany] = useState<SharedCompany>();
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [history, setHistory] = useState<readonly Match[]>([]);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

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
    const token = initialToken;
    if (!token) return;
    const expectedGeneration = ++generation.current;
    currentToken.current = token;
    let active = true;
    void (async () => {
      const known = (await cache.companies()).find((item) => item.token === token);
      if (!active || generation.current !== expectedGeneration) return;
      if (known) {
        setCompany(known);
        await applyCache(token, expectedGeneration);
      }
      try {
        const opened = await sync.open(token);
        if (!active || generation.current !== expectedGeneration) return;
        setCompany(opened);
        await applyCache(token, expectedGeneration);
        if (active && generation.current === expectedGeneration) void retry();
      } catch (cause) {
        if (!active || generation.current !== expectedGeneration) return;
        if (known) setNote(offlineNote);
        else setError(cause instanceof Error ? cause.message : "Компания не найдена или ссылка недействительна.");
      } finally {
        if (active && generation.current === expectedGeneration) setLoading(false);
      }
    })().catch((cause: unknown) => {
      if (active && generation.current === expectedGeneration) {
        setError(cause instanceof Error ? cause.message : "Ошибка локального хранилища");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [applyCache, cache, initialToken, retry, sync]);

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
    window.history.replaceState(null, "", `/g/${created.token}`);
  }, [sync]);

  const addPlayer = useCallback(async (name: string) => {
    const token = currentToken.current;
    if (!token) return;
    const player = await sync.addPlayer(token, name);
    if (currentToken.current === token) setPlayers((current) => [...current, player]);
  }, [sync]);

  const leaveCompany = useCallback(() => {
    generation.current += 1;
    currentToken.current = undefined;
    setCompany(undefined);
    setPlayers([]);
    setHistory([]);
    setNote(undefined);
    setError(undefined);
    window.history.replaceState(null, "", "/");
  }, []);

  return {
    loading,
    company,
    players,
    history,
    note,
    error,
    createCompany,
    addPlayer,
    leaveCompany,
    retry,
    syncAfterMatch: retry,
  };
}
