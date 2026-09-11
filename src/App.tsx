import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "./domain/match/models";
import { companySync, services } from "./app/compositionRoot";
import { SetupPage } from "./presentation/pages/SetupPage";
import { GamePage } from "./presentation/pages/GamePage";
import { SettingsPage } from "./presentation/pages/SettingsPage";
import { useCompanySync } from "./presentation/hooks/useCompanySync";
import { useMatchSession } from "./presentation/hooks/useMatchSession";
import { toGameViewModel } from "./presentation/game/gameViewModel";
import { Dialog } from "./presentation/components/Dialog";
import { persistentParticipantsInMatch, persistentStatisticsPlayers } from "./presentation/statistics/statisticsCorpus";
import { usePreferences } from "./presentation/hooks/usePreferences";
import { useLastSetup } from "./presentation/hooks/useLastSetup";
import { summarizeToday } from "./domain/statistics/todaySummary";
import "./presentation/styles.css";
import "./presentation/concept-overrides.css";
import "./presentation/active-game.css";
import "./presentation/statistics.css";
import "./presentation/stage3.css";
import "./presentation/stage4.css";
import "./presentation/stage46.css";

type Screen = "home" | "game" | "history" | "statistics" | "settings";
const HistoryPage = lazy(() => import("./presentation/pages/HistoryPage").then((module) => ({ default: module.HistoryPage })));
const StatisticsPage = lazy(() => import("./presentation/pages/StatisticsPage").then((module) => ({ default: module.StatisticsPage })));
const screenFallback = <main className="loading secondary-screen-loading">Открываем раздел…</main>;

function playersForMatches(saved: readonly Player[], matches: readonly Match[]): readonly Player[] {
  const byId = new Map(saved.map((player) => [player.id, player]));
  for (const match of matches) {
    for (const playerId of match.players) {
      if (!byId.has(playerId)) {
        byId.set(playerId, {
          id: playerId,
          name: match.participantNames[playerId] ?? "Игрок",
          createdAt: match.createdAt,
        });
      }
    }
  }
  return [...byId.values()];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [statisticsContext, setStatisticsContext] = useState<readonly PlayerId[]>([]);
  const [confirmResumeAbandon, setConfirmResumeAbandon] = useState(false);
  const showGame = useCallback(() => setScreen("game"), []);
  const showHome = useCallback(() => setScreen("home"), []);
  const company = useCompanySync({ sync: companySync, cache: services.shared });
  const preferences = usePreferences(services.settings);
  const match = useMatchSession({
    dependencies: services,
    companyToken: company.company?.token,
    onShowGame: showGame,
    onShowHome: showHome,
    onSessionClosed: company.syncAfterMatch,
  });
  const lastSetup = useLastSetup(services.lastSetups, company.company?.token);
  const visibleHistory = company.company ? company.history : match.history;
  const savedPlayers = company.company ? company.players : match.players;
  const persistentIds = useMemo(() => savedPlayers.map((player) => player.id), [savedPlayers]);
  const today = useMemo(() => summarizeToday(visibleHistory, persistentIds, new Date()), [persistentIds, visibleHistory]);
  const deleteProfile = async (playerId: string) => {
    const activeSession = match.active ?? match.resume;
    if (activeSession?.snapshot.match.status === "in_progress" && activeSession.snapshot.match.players.includes(playerId))
      throw new Error("Нельзя удалить игрока из незавершённого матча.");
    await (company.company ? company.deletePlayer(playerId) : match.deletePlayer(playerId));
  };

  if (company.loading || match.loading || lastSetup.loading) return <main className="loading">Загружаем дартс…</main>;
  const fatal = match.error ?? company.error;

  if (screen === "game" && match.active) {
    const gamePlayers = playersForMatches(savedPlayers, [match.active.snapshot.match]);
    return (
      <GamePage
        key={match.active.snapshot.match.id}
        session={match.active.session}
        initial={match.active.snapshot}
        players={gamePlayers}
        previousMatches={visibleHistory}
        onChange={match.setSnapshot}
        onBack={match.backToHome}
        onClosed={() => void match.close()}
        onStatistics={async (completedMatch) => {
          const relevantPlayers = persistentParticipantsInMatch(savedPlayers, completedMatch);
          await match.close();
          setStatisticsContext(relevantPlayers);
          setScreen("statistics");
        }}
        onRematch={(completedMatch) => match.rematch(completedMatch, savedPlayers)}
        persistentPlayerIds={savedPlayers.map((player) => player.id)}
        hapticsEnabled={preferences.hapticsEnabled}
      />
    );
  }
  if (screen === "history") {
    return <Suspense fallback={screenFallback}><HistoryPage matches={visibleHistory} players={playersForMatches(savedPlayers, visibleHistory)} persistentPlayerIds={persistentIds} onBack={showHome} onDelete={company.company ? company.deleteMatch : match.deleteMatch} onRematch={async (historicalMatch) => { try { await match.rematch(historicalMatch, savedPlayers); } catch (cause) { match.setError(cause instanceof Error ? cause.message : "Не удалось начать новый матч"); showHome(); } }} /></Suspense>;
  }
  if (screen === "statistics") {
    return <Suspense fallback={screenFallback}><StatisticsPage matches={visibleHistory} players={persistentStatisticsPlayers(savedPlayers, visibleHistory)} initialPlayerIds={statisticsContext} onBack={showHome} /></Suspense>;
  }
  if (screen === "settings") {
    return <SettingsPage players={savedPlayers} onRename={company.company ? company.renamePlayer : match.renamePlayer} onResetStatistics={company.company ? company.resetPlayerStatistics : match.resetPlayerStatistics} onDeletePlayer={deleteProfile} onBack={showHome} onExport={services.exportBackup} onRestore={services.restoreBackup} hapticsSupported={typeof navigator.vibrate === "function"} hapticsEnabled={preferences.hapticsEnabled} onHaptics={preferences.setHapticsEnabled} />;
  }

  const resumeView = match.resume ? toGameViewModel(match.resume.snapshot, playersForMatches(savedPlayers, [match.resume.snapshot.match])) : undefined;
  return (
    <>
      {fatal ? (
        <div className="fatal" role="alert">
          {fatal}{" "}
          <button className="secondary" onClick={() => void services.clearLocalData().then(() => location.reload())}>Сбросить повреждённые данные</button>
        </div>
      ) : null}
      {match.resume && resumeView ? (
        <aside className="resume">
          <div>
            <b>Продолжить матч</b>
            <span>{resumeView.title} · {resumeView.match.players.map((id) => resumeView.match.participantNames[id] ?? "Игрок").join(" / ")}</span>
            <span>Ход: {resumeView.currentPlayerName}{resumeView.currentPlayerDetail ? ` · ${resumeView.currentPlayerDetail}` : ""}</span>
            {resumeView.draftDescription ? <span>{resumeView.draftDescription}</span> : null}
          </div>
          <button className="primary" onClick={match.continueResume}>Продолжить</button>
          <button className="danger-quiet" onClick={() => setConfirmResumeAbandon(true)}>Прервать матч</button>
        </aside>
      ) : null}
      <SetupPage
        key={lastSetup.context}
        saved={savedPlayers}
        initialSetup={lastSetup.template}
        today={today}
        onStart={async (participants, setup) => {
          await lastSetup.remember(participants, setup);
          await match.start(participants, setup);
        }}
        onHistory={() => setScreen("history")}
        onStatistics={() => { setStatisticsContext([]); setScreen("statistics"); }}
        onAddLocalPlayer={company.company ? undefined : match.addPlayer}
        company={company.company}
        syncNote={company.note}
        onCreateCompany={company.createCompany}
        onAddSharedPlayer={company.addPlayer}
        onRetry={company.retry}
        onLeaveCompany={company.leaveCompany}
      />
      <nav className="home-links"><button className="link-button" onClick={() => setScreen("settings")}>Настройки</button></nav>
      {match.pendingStart && match.resume ? (
        <div className="dialog-backdrop">
          <section className="active-dialog" role="dialog" aria-modal="true" aria-labelledby="active-match-title">
            <h2 id="active-match-title">У вас уже есть незавершённая игра</h2>
            <p>Новая игра не заменит её без вашего явного выбора.</p>
            <button className="primary" onClick={match.continuePending}>Продолжить текущую</button>
            <button className="secondary" onClick={() => void match.replaceCurrent().catch((cause: unknown) => match.setError(cause instanceof Error ? cause.message : "Ошибка сохранения"))}>Покинуть текущую и начать новую</button>
            <button className="secondary" onClick={match.cancelPending}>Отмена</button>
          </section>
        </div>
      ) : null}
      <Dialog open={confirmResumeAbandon} title="Прервать текущий матч?" description="Незавершённый подход не попадёт в историю. Подтверждённые подходы сохранятся как прерванный матч." confirmLabel="Прервать матч" destructive onCancel={() => setConfirmResumeAbandon(false)} onConfirm={() => {
        setConfirmResumeAbandon(false);
        void match.abandonResume().catch((cause: unknown) => match.setError(cause instanceof Error ? cause.message : "Ошибка сохранения"));
      }} />
    </>
  );
}
