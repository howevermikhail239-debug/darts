import { useCallback, useState } from "react";
import type { Match, Player } from "./domain/match/models";
import { companySync, services } from "./app/compositionRoot";
import { SetupPage } from "./presentation/pages/SetupPage";
import { GamePage } from "./presentation/pages/GamePage";
import { HistoryPage } from "./presentation/pages/HistoryPage";
import { StatisticsPage } from "./presentation/pages/StatisticsPage";
import { SettingsPage } from "./presentation/pages/SettingsPage";
import { useCompanySync } from "./presentation/hooks/useCompanySync";
import { useMatchSession } from "./presentation/hooks/useMatchSession";
import { toGameViewModel } from "./presentation/game/gameViewModel";
import "./presentation/styles.css";
import "./presentation/concept-overrides.css";
import "./presentation/active-game.css";
import "./presentation/statistics.css";
import "./presentation/stage3.css";

type Screen = "home" | "game" | "history" | "statistics" | "settings";

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
  const showGame = useCallback(() => setScreen("game"), []);
  const showHome = useCallback(() => setScreen("home"), []);
  const company = useCompanySync({ sync: companySync, cache: services.shared });
  const match = useMatchSession({
    dependencies: services,
    companyToken: company.company?.token,
    onShowGame: showGame,
    onShowHome: showHome,
    onSessionClosed: company.syncAfterMatch,
  });

  if (company.loading || match.loading) return <main className="loading">Загружаем дартс…</main>;

  const visibleHistory = company.company ? company.history : match.history;
  const savedPlayers = company.company ? company.players : match.players;
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
      />
    );
  }
  if (screen === "history") {
    return <HistoryPage matches={visibleHistory} players={playersForMatches(savedPlayers, visibleHistory)} onBack={showHome} />;
  }
  if (screen === "statistics") {
    return <StatisticsPage matches={visibleHistory} players={playersForMatches(savedPlayers, visibleHistory)} onBack={showHome} />;
  }
  if (screen === "settings") {
    return <SettingsPage onBack={showHome} onExport={services.exportBackup} onRestore={services.restoreBackup} />;
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
          <button className="secondary" onClick={() => {
            if (!window.confirm("Прервать текущий матч? Незавершённый подход не попадёт в историю.")) return;
            void match.abandonResume().catch((cause: unknown) => match.setError(cause instanceof Error ? cause.message : "Ошибка сохранения"));
          }}>Прервать матч</button>
        </aside>
      ) : null}
      <SetupPage
        saved={savedPlayers}
        onStart={match.start}
        onHistory={() => setScreen("history")}
        onStatistics={() => setScreen("statistics")}
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
    </>
  );
}
