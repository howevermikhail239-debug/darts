import { useCallback, useEffect, useState } from "react";
import type { MatchSetup } from "../../domain/match/createMatch";
import type { Match, Player } from "../../domain/match/models";
import { GameSession, type Clock, type IdGenerator, type SessionSnapshot } from "../../application/GameSession";
import type { MatchRepository, PlayerRepository } from "../../application/ports/repositories";
import type { SetupParticipant } from "../pages/SetupPage";

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
      if (activeEffect) setError(cause instanceof Error ? cause.message : "Ошибка локального хранилища");
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
    close,
    backToHome,
    continueResume,
    abandonResume,
    continuePending: continueResume,
    replaceCurrent,
    cancelPending: () => setPendingStart(undefined),
  };
}
