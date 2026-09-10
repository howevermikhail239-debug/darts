import { useEffect, useState } from "react";
import type { MatchSetup } from "./domain/match/createMatch";
import type { Match, Player } from "./domain/match/models";
import { GameSession, type SessionSnapshot } from "./application/GameSession";
import { companySync, services } from "./app/compositionRoot";
import { SetupPage, type SetupParticipant } from "./presentation/pages/SetupPage";
import { GamePage } from "./presentation/pages/GamePage";
import { HistoryPage } from "./presentation/pages/HistoryPage";
import { StatisticsPage } from "./presentation/pages/StatisticsPage";
import { SettingsPage } from './presentation/pages/SettingsPage';
import "./presentation/styles.css";
import "./presentation/concept-overrides.css";
import "./presentation/active-game.css";
import "./presentation/statistics.css";
import './presentation/stage3.css';
import { isDetailedDraft } from './domain/match/VisitDraft';

type Screen = "loading" | "home" | "game" | "history" | "statistics" | 'settings';

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
  const [screen, setScreen] = useState<Screen>("loading");
  const [players, setPlayers] = useState<readonly Player[]>([]);
  const [history, setHistory] = useState<readonly Match[]>([]);
  const [session, setSession] = useState<GameSession>();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>();
  const [resume, setResume] = useState<{
    session: GameSession;
    snapshot: SessionSnapshot;
  }>();
  const [fatal, setFatal] = useState<string>();
  const [pendingStart, setPendingStart] = useState<{
    participants: readonly SetupParticipant[];
    setup: MatchSetup;
  }>();
  const [company, setCompany] = useState<{ token: string; name: string; createdAt: string }>();
  const [sharedPlayers, setSharedPlayers] = useState<readonly Player[]>([]);
  const [sharedHistory, setSharedHistory] = useState<readonly Match[]>([]);
  const [syncNote, setSyncNote] = useState<string>();
  useEffect(() => {
    const token = /^\/g\/([^/]+)$/.exec(location.pathname)?.[1];
    void Promise.all([
      services.players.list(),
      services.matches.listHistory(),
      services.matches.loadActive(),
    ])
      .then(async ([p, h, a]) => {
        setPlayers(p);
        setHistory(h);
        if (token) {
          const known = (await services.shared.companies()).find(item => item.token === token);
          if (known) {
            setCompany(known);
            const [sp, sm] = await Promise.all([services.shared.players(token), services.shared.matches(token)]);
            setSharedPlayers(sp); setSharedHistory(sm.map(x => x.match));
          }
          try { const c = await companySync.open(token); setCompany(c); const [sp, sm] = await Promise.all([services.shared.players(token), services.shared.matches(token)]); setSharedPlayers(sp); setSharedHistory(sm.map(x=>x.match)); void companySync.sync(token).then(async()=>{ const [nextPlayers, nextMatches] = await Promise.all([services.shared.players(token), services.shared.matches(token)]); setSharedPlayers(nextPlayers); setSharedHistory(nextMatches.map(x=>x.match)); }).catch(()=>setSyncNote('Нет связи. Матч сохранится и отправится позже.')); }
          catch (e) { if (known) setSyncNote('Нет связи. Матч сохранится и отправится позже.'); else setFatal(e instanceof Error ? e.message : 'Компания не найдена или ссылка недействительна.'); }
        }
        if (
          a?.current.status === "in_progress" ||
          a?.current.status === "completed"
        ) {
          const s = new GameSession(
            a.current,
            services.matches,
            services.id,
            services.now,
            a.previous,
            a.draft,
            a.draftRecovery,
            a.companyToken,
          );
          setResume({
            session: s,
            snapshot: s.snapshot(),
          });
        }
        setScreen("home");
      })
      .catch((e) => {
        setFatal(
          e instanceof Error ? e.message : "Ошибка локального хранилища",
        );
        setScreen("home");
      });
  }, []);
  useEffect(() => {
    if (!company) return;
    const retry = () => void companySync.sync(company.token).then(async () => {
      const cached = await services.shared.matches(company.token);
      setSharedHistory(cached.map(item => item.match));
      setSyncNote(cached.some(item => item.state !== 'synced') ? 'Матч ожидает отправки.' : 'Все матчи синхронизированы');
    }).catch(() => setSyncNote('Нет связи. Матч сохранится и отправится позже.'));
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [company]);
  const performStart = async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    const { session: s } = await services.startMatch(participants, setup, company?.token);
    setSession(s);
    setSnapshot(s.snapshot());
    setResume(undefined);
    setScreen("game");
  };
  const start = async (participants: readonly SetupParticipant[], setup: MatchSetup) => {
    if (resume) {
      setPendingStart({ participants, setup });
      return;
    }
    await performStart(participants, setup);
  };
  const leave = async () => {
    setSession(undefined);
    setSnapshot(undefined);
    setResume(undefined);
    setHistory(await services.matches.listHistory());
    if (company) { void companySync.sync(company.token).then(async()=>{ const cached=await services.shared.matches(company.token); setSharedHistory(cached.map(x=>x.match)); setSyncNote(cached.some(item=>item.state !== 'synced') ? 'Матч ожидает отправки.' : 'Все матчи синхронизированы'); }).catch(()=>setSyncNote('Нет связи. Матч сохранится и отправится позже.')); }
    setScreen("home");
  };
  const backToHome = () => {
    if (session && snapshot) setResume({ session, snapshot });
    setSession(undefined);
    setSnapshot(undefined);
    setScreen("home");
  };
  if (screen === "loading")
    return <main className="loading">Загружаем дартс…</main>;
  if (screen === "game" && session && snapshot)
    return (
      <GamePage
        key={snapshot.match.id}
        session={session}
        initial={snapshot}
        players={playersForMatches(company ? sharedPlayers : players, [snapshot.match])}
        previousMatches={company ? sharedHistory : history}
        onChange={setSnapshot}
        onBack={backToHome}
        onClosed={() => void leave()}
      />
    );
  if (screen === "history")
    return (
      <HistoryPage
        matches={company ? sharedHistory : history}
        players={playersForMatches(company ? sharedPlayers : players, company ? sharedHistory : history)}
        onBack={() => setScreen("home")}
      />
    );
  if (screen === "statistics")
    return <StatisticsPage matches={company ? sharedHistory : history} players={playersForMatches(company ? sharedPlayers : players, company ? sharedHistory : history)} onBack={() => setScreen("home")} />;
  if (screen === 'settings') return <SettingsPage onBack={()=>setScreen('home')} onExport={services.exportBackup} onRestore={services.restoreBackup}/>;
  return (
    <>
      {fatal ? <div className="fatal" role="alert">{fatal} <button className="secondary" onClick={()=>void services.clearLocalData().then(()=>location.reload())}>Сбросить повреждённые данные</button></div> : null}
      {resume ? (
        <aside className="resume">
          <div>
            <b>Продолжить матч</b>
            <span>
              {resume.snapshot.match.state.kind === "x01" ? resume.snapshot.match.state.startingScore : "Серия"} ·
              {" "}{resume.snapshot.match.players.map((id) => resume.snapshot.match.participantNames[id] ?? "Игрок").join(" / ")}
            </span>
            <span>
              Ход: {resume.snapshot.match.participantNames[resume.snapshot.match.players[resume.snapshot.match.currentPlayerIndex]!] ?? "Игрок"}
              {resume.snapshot.match.state.kind === "x01" ? ` · остаток: ${resume.snapshot.match.state.remaining[resume.snapshot.match.players[resume.snapshot.match.currentPlayerIndex]!]}` : ""}
            </span>
            {(isDetailedDraft(resume.snapshot.draft) ? resume.snapshot.draft.darts.length > 0 : resume.snapshot.draft.score !== undefined) ? (
              <span>Незавершённый подход · {isDetailedDraft(resume.snapshot.draft) ? `${resume.snapshot.draft.darts.length}/3 дротика` : `сумма ${resume.snapshot.draft.score}`}</span>
            ) : null}
          </div>
          <button
            className="primary"
            onClick={() => {
              setSession(resume.session);
              setSnapshot(resume.snapshot);
              setScreen("game");
            }}
          >
            Продолжить
          </button>
          <button
            className="secondary"
            onClick={() => {
              if (!window.confirm("Прервать текущий матч? Незавершённый подход не попадёт в историю.")) return;
              void resume.session.abandon().then(leave).catch((e) =>
                setFatal(e instanceof Error ? e.message : "Ошибка сохранения"),
              );
            }}
          >
            Прервать матч
          </button>
        </aside>
      ) : null}
      <SetupPage
        saved={company ? sharedPlayers : players}
        onStart={start}
        onHistory={() => setScreen("history")}
        onStatistics={() => setScreen("statistics")}
        company={company}
        syncNote={syncNote}
        onCreateCompany={async name => { const c = await companySync.create(name); setCompany(c); window.history.replaceState(null, '', `/g/${c.token}`); setSharedPlayers([]); setSharedHistory([]); }}
        onAddSharedPlayer={async name => { if (!company) return; const player = await companySync.addPlayer(company.token, name); setSharedPlayers(current => [...current, player]); }}
        onRetry={async () => { if (!company) return; await companySync.sync(company.token); const cached = await services.shared.matches(company.token); setSharedHistory(cached.map(item=>item.match)); setSyncNote(cached.some(item=>item.state !== 'synced') ? 'Матч ожидает отправки.' : 'Все матчи синхронизированы'); }}
        onLeaveCompany={() => { setCompany(undefined); setSharedPlayers([]); setSharedHistory([]); window.history.replaceState(null, '', '/'); }}
      />
      <nav className="home-links"><button className="link-button" onClick={()=>setScreen('settings')}>Настройки</button></nav>
      {pendingStart && resume ? (
        <div className="dialog-backdrop">
          <section className="active-dialog" role="dialog" aria-modal="true" aria-labelledby="active-match-title">
            <h2 id="active-match-title">У вас уже есть незавершённая игра</h2>
            <p>Новая игра не заменит её без вашего явного выбора.</p>
            <button className="primary" onClick={() => {
              setPendingStart(undefined);
              setSession(resume.session);
              setSnapshot(resume.snapshot);
              setScreen("game");
            }}>Продолжить текущую</button>
            <button className="secondary" onClick={() => {
              const requested = pendingStart;
              void (resume.snapshot.match.status === "completed"
                ? resume.session.finalize()
                : resume.session.abandon())
                .then(async () => {
                  setPendingStart(undefined);
                  setResume(undefined);
                  setHistory(await services.matches.listHistory());
                  await performStart(requested.participants, requested.setup);
                })
                .catch((e) => setFatal(e instanceof Error ? e.message : "Ошибка сохранения"));
            }}>Покинуть текущую и начать новую</button>
            <button className="secondary" onClick={() => setPendingStart(undefined)}>Отмена</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
