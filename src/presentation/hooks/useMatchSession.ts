import { useCallback, useEffect, useState } from "react";
import type { MatchSetup } from "../../domain/match/createMatch";
import type { Match, Player } from "../../domain/match/models";
import { GameSession, type Clock, type IdGenerator, type SessionSnapshot } from "../../application/GameSession";
import type { MatchRepository, PlayerRepository } from "../../application/ports/repositories";
import type { SetupParticipant } from "../pages/SetupPage";
import { prepareRematch } from "../../application/PrepareRematch";
import { STORAGE_FAILURE } from "../errors/userMessage";

type ActiveSession = Readonly<{ session: GameSession; snapshot: SessionSnapshot }>;
type PendingStart = Readonly<{ participants: readonly SetupParticipant[]; setup: MatchSetup }>;
type Dependencies = Readonly<{
  matches: MatchRepository;
  players: PlayerRepository;
  id: IdGenerator;
  now: Clock;
  startMatch(participants: readonly SetupParticipant[], setup: MatchSetup, companyToken?: string): Promise<{ session: GameSession }>;
}>;

type Options = Readonly<{
  dependencies: Dependencies;
  companyToken: string | undefined;
  onShowGame(): void;
  onShowHome(): void;
  onSessionClosed(): Promise<void>;
}>;

export function useMatchSession({ dependencies, companyToken, onShowGame, onShowHome, onSessionClosed }: Options) {
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [history, setHistory] = useState<readonly Match[]>([]);
  const [active, setActive] = useState<ActiveSession>();
  const [resume, setResume] = useState<ActiveSession>();
  const [pendingStart, setPendingStart] = useState<PendingStart>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let activeEffect = true;
    void Promise.all([
      dependencies.players.list(),
      dependencies.matches.listHistory(),
      dependencies.matches.loadActive(),
    ]).then(([savedPlayers, savedHistory, savedActive]) => {
      if (!activeEffect) return;
      setPlayers(savedPlayers);
      setHistory(savedHistory);
      if (savedActive?.current.status === "in_progress" || savedActive?.current.status === "completed") {
        const session = new GameSession(
          savedActive.current,
          dependencies.matches,
          dependencies.id,
          dependencies.now,
          savedActive.previous,
          savedActive.draft,
          savedActive.draftRecovery,
          savedActive.companyToken,
        );
        setResume({ session, snapshot: session.snapshot() });
      }
    }).catch((cause: unknown) => {
      // DATA-4: это отказ ЛОКАЛЬНОГО ХРАНИЛИЩА — единственная по-настоящему
      // фатальная категория. Техническая подробность идёт в консоль, а не в интерфейс.
      console.error("Отказ локального хранилища при загрузке данных:", cause);
      if (activeEffect) setError(STORAGE_FAILURE);
    }).finally(() => {
      if (activeEffect) setLoading(false);
    });
    return () => { activeEffect = false; };
  }, [dependencies]);

  const performStart = useCallback(async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    const { session } = await dependencies.startMatch(participants, setup, companyToken);
    setActive({ session, snapshot: session.snapshot() });
    setResume(undefined);
    onShowGame();
  }, [companyToken, dependencies, onShowGame]);

  const addPlayer = useCallback(async (name: string) => {
    const player: Player = { id: dependencies.id(), name: name.trim(), createdAt: dependencies.now() };
    if (!player.name) throw new Error("Введите имя игрока");
    await dependencies.players.save(player);
    setPlayers(await dependencies.players.list());
    return player;
  }, [dependencies]);
  const renamePlayer = useCallback(async (playerId: string, name: string) => {
    const trimmed = name.trim(); if (!trimmed || trimmed.length > 80) throw new Error("Имя должно содержать от 1 до 80 символов.");
    const player = (await dependencies.players.list()).find((item) => item.id === playerId); if (!player) throw new Error("Игрок не найден.");
    await dependencies.players.save({ ...player, name: trimmed }); setPlayers(await dependencies.players.list());
  }, [dependencies]);
  const resetPlayerStatistics = useCallback(async (playerId: string) => {
    const player = (await dependencies.players.list()).find((item) => item.id === playerId); if (!player) throw new Error("Игрок не найден.");
    await dependencies.players.save({ ...player, statsResetAt: dependencies.now() }); setPlayers(await dependencies.players.list());
  }, [dependencies]);
  // Правило «нельзя удалить игрока из незавершённого матча» живёт в одном месте —
  // в `useDataSource`, который одинаково закрывает локальный режим и режим компании (ARCH-3).
  const deletePlayer = useCallback(async (playerId: string) => {
    if (!dependencies.players.delete) throw new Error("Удаление профиля недоступно.");
    await dependencies.players.delete(playerId); setPlayers(await dependencies.players.list());
  }, [dependencies]);
  const deleteMatch = useCallback(async (matchId: string) => { if (!dependencies.matches.deleteHistory) throw new Error("Удаление матча недоступно."); await dependencies.matches.deleteHistory(matchId); setHistory(await dependencies.matches.listHistory()); }, [dependencies]);

  const start = useCallback(async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    if (resume) {
      setPendingStart({ participants, setup });
      return;
    }
    await performStart(participants, setup);
  }, [performStart, resume]);

  const close = useCallback(async () => {
    setActive(undefined);
    setResume(undefined);
    setHistory(await dependencies.matches.listHistory());
    await onSessionClosed();
    onShowHome();
  }, [dependencies, onSessionClosed, onShowHome]);

  const backToHome = useCallback(() => {
    if (active) setResume(active);
    setActive(undefined);
    onShowHome();
  }, [active, onShowHome]);

  const continueResume = useCallback(() => {
    if (!resume) return;
    setActive(resume);
    onShowGame();
  }, [onShowGame, resume]);

  const abandonResume = useCallback(async () => {
    if (!resume) return;
    await resume.session.abandon();
    await close();
  }, [close, resume]);

  const replaceCurrent = useCallback(async () => {
    if (!pendingStart || !resume) return;
    const requested = pendingStart;
    if (resume.snapshot.match.status === "completed") await resume.session.finalize();
    else await resume.session.abandon();
    setPendingStart(undefined);
    setResume(undefined);
    setHistory(await dependencies.matches.listHistory());
    await performStart(requested.participants, requested.setup);
  }, [dependencies, pendingStart, performStart, resume]);

  const rematch = useCallback(async (source: Match, participantCatalog: readonly Player[] = players) => {
    const request = prepareRematch(source, participantCatalog);
    const current = active ?? resume;
    if (current?.snapshot.match.id === source.id) {
      await current.session.finalize();
      setHistory(await dependencies.matches.listHistory());
      await onSessionClosed();
      await performStart(request.participants, request.setup);
      return;
    }
    if (resume) {
      setPendingStart(request);
      onShowHome();
      return;
    }
    await performStart(request.participants, request.setup);
  }, [active, dependencies, onSessionClosed, onShowHome, performStart, players, resume]);

  return {
    loading,
    players,
    history,
    active,
    resume,
    pendingStart,
    error,
    setError,
    setSnapshot: (snapshot: SessionSnapshot) => setActive((current) => current ? { ...current, snapshot } : current),
    start,
    addPlayer,
    renamePlayer,
    resetPlayerStatistics,
    deletePlayer,
    deleteMatch,
    close,
    backToHome,
    continueResume,
    abandonResume,
    continuePending: continueResume,
    replaceCurrent,
    rematch,
    cancelPending: () => setPendingStart(undefined),
  };
}
