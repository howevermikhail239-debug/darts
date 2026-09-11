import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "./domain/match/models";
import { companySync, services } from "./app/compositionRoot";
import { SetupPage } from "./presentation/pages/SetupPage";
import { GamePage } from "./presentation/pages/GamePage";
import { SettingsPage } from "./presentation/pages/SettingsPage";
import { useCompanySync } from "./presentation/hooks/useCompanySync";
import { useMatchSession } from "./presentation/hooks/useMatchSession";
import { useDataSource } from "./presentation/hooks/useDataSource";
import { useScreenHistory } from "./presentation/hooks/useScreenHistory";
import { useAppUpdate } from "./presentation/hooks/useAppUpdate";
import { toGameViewModel } from "./presentation/game/gameViewModel";
import { Dialog } from "./presentation/components/Dialog";
import { UpdateBanner } from "./presentation/components/UpdateBanner";
import { KnownCompanies } from "./presentation/components/KnownCompanies";
import { userMessage } from "./presentation/errors/userMessage";
import { collectRawDump, countLocalData, downloadRawDump, type LocalDataCounts } from "./presentation/data/rawBackup";
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

/** Профили матча, у которых есть постоянная статистика (бывший `statisticsCorpus`, OOP-2). */
function persistentParticipantsInMatch(savedPlayers: readonly Player[], match: Match): readonly PlayerId[] {
  const savedIds = new Set(savedPlayers.map((player) => player.id));
  return match.players.filter((playerId) => savedIds.has(playerId));
}

const plural = (count: number, one: string, few: string, many: string): string => {
  const mod100 = Math.abs(count) % 100, mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
};

const wipeDescriptionFor = (counts: LocalDataCounts | undefined): string => {
  if (!counts) return "Считаем, сколько данных хранится на устройстве…";
  if (!counts.exact)
    return "Сколько матчей и профилей хранится, посчитать не удалось — данные повреждены. Будет удалено всё локальное хранилище приложения: история, профили, настройки и данные компаний. Отменить это нельзя.";
  const matches = counts.matches ?? 0, players = counts.players ?? 0;
  return `Будут удалены ${matches} ${plural(matches, "матч", "матча", "матчей")} и ${players} ${plural(players, "профиль", "профиля", "профилей")}, а также настройки и данные компаний на этом устройстве. Отменить это нельзя.`;
};

export default function App() {
  const { screen, show, replace } = useScreenHistory();
  const [statisticsContext, setStatisticsContext] = useState<readonly PlayerId[]>([]);
  const [confirmResumeAbandon, setConfirmResumeAbandon] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeCounts, setWipeCounts] = useState<LocalDataCounts>();
  const [wipeError, setWipeError] = useState<string>();
  const [dumpNote, setDumpNote] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const showGame = useCallback(() => show("game"), [show]);
  const showHome = useCallback(() => show("home"), [show]);
  const company = useCompanySync({ sync: companySync, cache: services.shared });
  const preferences = usePreferences(services.settings);
  const match = useMatchSession({
    dependencies: services,
    companyToken: company.company?.token,
    onShowGame: showGame,
    onShowHome: showHome,
    onSessionClosed: company.syncAfterMatch,
  });
  const data = useDataSource(company, match);
  const lastSetup = useLastSetup(services.lastSetups, company.company?.token);
  const appUpdate = useAppUpdate();
  const persistentIds = useMemo(() => data.players.map((player) => player.id), [data.players]);
  const today = useMemo(() => summarizeToday(data.history, persistentIds, new Date()), [persistentIds, data.history]);
  const activeSessionMatch = (match.active ?? match.resume)?.snapshot.match;
  const matchInProgress = activeSessionMatch?.status === "in_progress";

  // CLI-1: аппаратная кнопка «Назад» может увести с экрана игры — сохраняем матч
  // как возобновляемый ровно так же, как это делает кнопка «‹» в шапке.
  useEffect(() => {
    if (screen !== "game" && match.active) match.backToHome();
  }, [match, screen]);
  // Обратная сторона: запись истории «игра» без активного матча (например, после
  // завершения) не должна показывать пустой экран.
  useEffect(() => {
    if (screen === "game" && !match.active && !match.loading) replace("home");
  }, [match.active, match.loading, replace, screen]);

  useEffect(() => {
    if (!confirmWipe) return;
    let alive = true;
    void countLocalData().then((counts) => { if (alive) setWipeCounts(counts); }).catch(() => { if (alive) setWipeCounts({ exact: false }); });
    return () => { alive = false; };
  }, [confirmWipe]);

  const saveRawDump = useCallback(async () => {
    setDumpNote("Собираем всё, что читается…");
    try {
      const dump = await collectRawDump();
      if (dump.unreadable) { setDumpNote("Локальная база не открывается — выгружать нечего."); return; }
      downloadRawDump(dump);
      setDumpNote(dump.skipped > 0
        ? `Файл сохранён. Прочитать не удалось записей: ${dump.skipped} — они в файл не попали.`
        : "Файл сохранён.");
    } catch (cause) {
      setDumpNote(userMessage(cause, "Не удалось выгрузить данные."));
    }
  }, []);

  const deleteProfile = data.deletePlayer;

  if (company.loading || match.loading || lastSetup.loading) return <main className="loading">Загружаем дартс…</main>;

  // DATA-4: отказ локального хранилища — фатальная ошибка со стиранием как крайней
  // мерой. Ошибка сети или компании — обычное уведомление с кнопкой «Повторить».
  const storageFailure = match.error ?? company.storageError;
  const updateBanner = appUpdate.available && !updateDismissed
    ? <UpdateBanner matchInProgress={Boolean(matchInProgress)} onUpdate={appUpdate.apply} onDismiss={() => setUpdateDismissed(true)} />
    : null;

  if (screen === "game" && match.active) {
    const gamePlayers = playersForMatches(data.players, [match.active.snapshot.match]);
    return (
      <>
        {updateBanner}
        <GamePage
          key={match.active.snapshot.match.id}
          session={match.active.session}
          initial={match.active.snapshot}
          players={gamePlayers}
          previousMatches={data.history}
          onChange={match.setSnapshot}
          onBack={match.backToHome}
          onClosed={() => void match.close().catch((cause: unknown) => setActionError(userMessage(cause, "Не удалось закрыть матч.")))}
          onStatistics={async (completedMatch) => {
            const relevantPlayers = persistentParticipantsInMatch(data.players, completedMatch);
            await match.close();
            setStatisticsContext(relevantPlayers);
            show("statistics");
          }}
          onRematch={(completedMatch) => match.rematch(completedMatch, data.players)}
          persistentPlayerIds={persistentIds}
          hapticsEnabled={preferences.hapticsEnabled}
        />
      </>
    );
  }
  if (screen === "history") {
    return <Suspense fallback={screenFallback}><HistoryPage matches={data.history} players={playersForMatches(data.players, data.history)} persistentPlayerIds={persistentIds} onBack={showHome} onDelete={data.deleteMatch} onRematch={async (historicalMatch) => { try { await match.rematch(historicalMatch, data.players); } catch (cause) { setActionError(userMessage(cause, "Не удалось начать новый матч.")); showHome(); } }} /></Suspense>;
  }
  if (screen === "statistics") {
    return <Suspense fallback={screenFallback}><StatisticsPage matches={data.history} players={data.players} initialPlayerIds={statisticsContext} onBack={showHome} /></Suspense>;
  }
  if (screen === "settings") {
    return <SettingsPage players={data.players} onRename={data.renamePlayer} onResetStatistics={data.resetPlayerStatistics} onDeletePlayer={deleteProfile} onBack={showHome} onExport={services.exportBackup} onRestore={services.restoreBackup} hapticsSupported={typeof navigator.vibrate === "function"} hapticsEnabled={preferences.hapticsEnabled} onHaptics={preferences.setHapticsEnabled} />;
  }

  const resumeView = match.resume ? toGameViewModel(match.resume.snapshot, playersForMatches(data.players, [match.resume.snapshot.match])) : undefined;
  return (
    <>
      {updateBanner}
      {storageFailure ? (
        <div className="fatal" role="alert">
          <p>{storageFailure}</p>
          <p>Сначала закройте другие вкладки приложения и обновите страницу — чаще всего этого достаточно.</p>
          <button className="secondary" onClick={() => location.reload()}>Обновить страницу</button>
          <button className="secondary" onClick={() => void saveRawDump()}>Выгрузить данные в файл</button>
          <button className="danger-quiet" onClick={() => { setWipeError(undefined); setConfirmWipe(true); }}>Сбросить повреждённые данные</button>
          {dumpNote ? <p role="status">{dumpNote}</p> : null}
          {wipeError ? <p className="reason">{wipeError}</p> : null}
        </div>
      ) : null}
      {company.error ? (
        <div className="notice company-error" role="status">
          <span>{company.error}</span>
          <button className="link-button" onClick={() => void company.retry().catch(() => undefined)}>Повторить</button>
        </div>
      ) : null}
      {actionError ? (
        <div className="error" role="alert">
          <span>{actionError}</span>
          <button className="link-button" onClick={() => setActionError(undefined)}>Понятно</button>
        </div>
      ) : null}
      {match.resume && resumeView ? (
        <aside className="resume">
          <div>
            <b>{resumeView.completed ? "Матч завершён" : "Продолжить матч"}</b>
            <span>{resumeView.title} · {resumeView.match.players.map((id) => resumeView.match.participantNames[id] ?? "Игрок").join(" / ")}</span>
            {resumeView.completed
              ? <span>{resumeView.summaryTitle} · итоги сохранены</span>
              : <span>Ход: {resumeView.currentPlayerName}{resumeView.currentPlayerDetail ? ` · ${resumeView.currentPlayerDetail}` : ""}</span>}
            {!resumeView.completed && resumeView.draftDescription ? <span>{resumeView.draftDescription}</span> : null}
          </div>
          <button className="primary" onClick={match.continueResume}>{resumeView.completed ? "Открыть итоги" : "Продолжить"}</button>
          {/* DATA-3: у завершённого матча прерывать нечего — на месте разрушительной кнопки безопасное действие. */}
          {resumeView.completed
            ? <button className="secondary" onClick={match.continueResume}>Показать результат</button>
            : <button className="danger-quiet" onClick={() => setConfirmResumeAbandon(true)}>Прервать матч</button>}
        </aside>
      ) : null}
      <KnownCompanies companies={company.knownCompanies} currentToken={company.company?.token} onOpen={company.openCompany} />
      <SetupPage
        key={lastSetup.context}
        saved={data.players}
        initialSetup={lastSetup.template}
        today={today}
        onStart={async (participants, setup) => {
          await lastSetup.remember(participants, setup);
          await match.start(participants, setup);
        }}
        onHistory={() => show("history")}
        onStatistics={() => { setStatisticsContext([]); show("statistics"); }}
        onAddLocalPlayer={data.shared ? undefined : data.addPlayer}
        company={company.company}
        syncNote={company.note}
        onCreateCompany={company.createCompany}
        onAddSharedPlayer={company.addPlayer}
        onRetry={company.retry}
        onLeaveCompany={company.leaveCompany}
        inviteLink={company.inviteLink}
      />
      <nav className="home-links"><button className="link-button" onClick={() => show("settings")}>Настройки</button></nav>
      {match.pendingStart && match.resume ? (
        <div className="dialog-backdrop">
          <section className="active-dialog" role="dialog" aria-modal="true" aria-labelledby="active-match-title">
            <h2 id="active-match-title">У вас уже есть незавершённая игра</h2>
            <p>Новая игра не заменит её без вашего явного выбора.</p>
            <button className="primary" onClick={match.continuePending}>Продолжить текущую</button>
            <button className="secondary" onClick={() => void match.replaceCurrent().catch((cause: unknown) => setActionError(userMessage(cause, "Не удалось сохранить текущий матч.")))}>Покинуть текущую и начать новую</button>
            <button className="secondary" onClick={match.cancelPending}>Отмена</button>
          </section>
        </div>
      ) : null}
      <Dialog open={confirmResumeAbandon} title="Прервать текущий матч?" description="Незавершённый подход не попадёт в историю. Подтверждённые подходы сохранятся как прерванный матч." confirmLabel="Прервать матч" destructive onCancel={() => setConfirmResumeAbandon(false)} onConfirm={() => {
        setConfirmResumeAbandon(false);
        void match.abandonResume().catch((cause: unknown) => setActionError(userMessage(cause, "Не удалось прервать матч.")));
      }} />
      <Dialog open={confirmWipe} title="Стереть все данные на этом устройстве?" description={wipeDescriptionFor(wipeCounts)} confirmLabel="Стереть всё" destructive onCancel={() => setConfirmWipe(false)} onConfirm={() => {
        setConfirmWipe(false);
        setWipeError(undefined);
        void services.clearLocalData()
          .then(() => location.reload())
          .catch((cause: unknown) => setWipeError(userMessage(cause, "Не удалось стереть данные. Закройте другие вкладки и окна приложения и попробуйте ещё раз.")));
      }} />
    </>
  );
}
