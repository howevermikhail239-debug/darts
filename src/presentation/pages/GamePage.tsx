import { useState } from "react";
import {
  bull,
  miss,
  numberThrow,
  outerBull,
  type Multiplier,
} from "../../domain/darts/DartThrow";
import type { Match, Player } from "../../domain/match/models";
import { newRecordsForMatch } from "../../domain/statistics/StatisticsCalculator";
import type {
  GameSession,
  SessionSnapshot,
} from "../../application/GameSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { Scoreboard } from "../components/Scoreboard";
import { DraftPanel } from "../components/DraftPanel";
import { DartPad } from "../components/DartPad";
import { t } from "../strings";
import { draftIsEmpty, isDetailedDraft } from '../../domain/match/VisitDraft';
import { toGameViewModel } from "../game/gameViewModel";
import { Dialog } from "../components/Dialog";
type PendingDialog = { title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => void };
type Props = {
  session: GameSession;
  initial: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onChange: (s: SessionSnapshot) => void;
  onBack: () => void;
  onClosed: () => void;
};
export function GamePage({
  session,
  initial,
  players,
  previousMatches,
  onChange,
  onBack,
  onClosed,
}: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [multiplier, setMultiplier] = useState<Multiplier>(1);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<PendingDialog>();
  useWakeLock(snapshot.match.status === "in_progress");
  const update = (s: SessionSnapshot) => {
    setSnapshot(s);
    onChange(s);
    setError(undefined);
  };
  const enter = async (dart: ReturnType<typeof miss>) => {
    try {
      const pending = session.record(dart, selected);
      update(session.snapshot());
      update(await pending);
      setSelected(undefined);
      setMultiplier(1);
    } catch (e) {
      update(session.snapshot());
      setError(e instanceof Error ? e.message : "Ошибка ввода");
    }
  };
  const undo = async () => {
    try {
      const hasDraft = !draftIsEmpty(snapshot.draft);
      if (hasDraft) {
        setDialog({ title: "Отменить предыдущий подход?", description: "Текущий незавершённый подход будет сброшен. Это действие нельзя отменить.", confirmLabel: "Сбросить и отменить", destructive: true, action: () => { setDialog(undefined); void undoConfirmed(true); } });
        return;
      }
      await undoConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };
  const undoConfirmed = async (discardDraft: boolean) => {
    try {
      update(await session.undo(discardDraft));
      setSelected(undefined);
      setMultiplier(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };
  const changeInputMode = (mode: "detailed" | "aggregate") => {
    const apply = (discard: boolean) => void session.setInputMode(mode, discard).then(update).catch(e => setError(e instanceof Error ? e.message : "Ошибка сохранения"));
    if (draftIsEmpty(snapshot.draft)) { apply(false); return; }
    setDialog({ title: "Переключить способ ввода?", description: "Текущий незавершённый подход будет сброшен.", confirmLabel: "Сбросить и переключить", destructive: true, action: () => { setDialog(undefined); apply(true); } });
  };
  const confirm = async () => {
    try {
      const pending = session.confirm();
      update(session.snapshot());
      update(await pending);
    } catch (e) {
      update(session.snapshot());
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };
  const view = toGameViewModel(snapshot, players);
  if (view.completed)
    return (
      <Summary
        snapshot={snapshot}
        players={players}
        previousMatches={previousMatches}
        onUndo={async () => update(await session.undo())}
        onFinish={async () => {
          await session.finalize();
          onClosed();
        }}
      />
    );
  return (
    <main className="game-page">
      <header className="game-header">
        <button
          className="text-icon"
          onClick={onBack}
          aria-label="На главный экран"
        >
          ‹
        </button>
        <div>
          <strong>
            {view.title}
          </strong>
          <span>
            {view.phaseLabel}
          </span>
        </div>
        <button
          className="text-icon"
          onClick={() => setDialog({ title: "Прервать матч?", description: "Незавершённый подход не попадёт в историю. Подтверждённые результаты сохранятся как прерванный матч.", confirmLabel: "Прервать матч", destructive: true, action: () => { setDialog(undefined); void session.abandon().then(onClosed).catch((e) => setError(e instanceof Error ? e.message : "Ошибка сохранения")); } })}
          aria-label={t.abandon}
        >
          ×
        </button>
      </header>
      <Scoreboard rows={view.scoreboard} />
      <div className="current-label">
        ● {t.currentVisit}: <strong>{view.currentPlayerName}</strong>
      </div>
      <div className="segments input-mode" aria-label="Способ ввода">
        <button type="button" className={isDetailedDraft(snapshot.draft)?'selected':''} aria-pressed={isDetailedDraft(snapshot.draft)} onClick={()=>changeInputMode('detailed')}>По дротикам</button>
        <button type="button" className={!isDetailedDraft(snapshot.draft)?'selected':''} aria-pressed={!isDetailedDraft(snapshot.draft)} onClick={()=>changeInputMode('aggregate')}>Суммой за подход</button>
      </div>
      {!isDetailedDraft(snapshot.draft)?<label className="aggregate-input">Сумма за подход<input type="number" min="0" max="180" step="1" value={snapshot.draft.score??''} onChange={event=>{const value=event.target.value===''?undefined:Number(event.target.value);void session.setAggregateScore(value).then(update).catch(e=>setError(e instanceof Error?e.message:'Ошибка сохранения'));}}/></label>:null}
      <DraftPanel
        snapshot={snapshot}
        hint={view.draftHint}
        canConfirm={view.canConfirm}
        confirmLabel={view.confirmLabel}
        selected={selected}
        onSelect={(i) => setSelected(selected === i ? undefined : i)}
        onRemove={() => {
          const pending = session.remove();
          update(session.snapshot());
          void pending.then(update).catch((e) => {
            update(session.snapshot());
            setError(e instanceof Error ? e.message : "Ошибка сохранения");
          });
        }}
        onReset={() => {
          const pending = session.reset();
          update(session.snapshot());
          void pending.then((value) => {
            update(value);
            setMultiplier(1);
            setSelected(undefined);
          }).catch((e) => {
            update(session.snapshot());
            setError(e instanceof Error ? e.message : "Ошибка сохранения");
          });
        }}
        onConfirm={() => void confirm()}
      />
      {view.awaitingTieDecision ? (
        <div className="tie-panel">
          <h2>{t.draw}</h2>
          <button
            className="primary"
            onClick={() =>
              void session.extraRound().then(update).catch((e) =>
                setError(e instanceof Error ? e.message : "Ошибка сохранения"),
              )
            }
          >
            {t.extra}
          </button>
          {view.canCompleteDraw ? <button
              className="secondary"
              onClick={() =>
                void session.completeDraw().then(update).catch((e) =>
                  setError(e instanceof Error ? e.message : "Ошибка сохранения"),
                )
              }
            >
              {t.finishDraw}
            </button> : null}
        </div>
      ) : (
        isDetailedDraft(snapshot.draft)?<DartPad
          multiplier={multiplier}
          disabled={!view.canAddNextDart && selected === undefined}
          onMultiplier={setMultiplier}
          onNumber={(n) => void enter(numberThrow(n, multiplier))}
          onBull={(kind) =>
            void enter(
              kind === "outer"
                ? outerBull()
                : kind === "bull"
                  ? bull()
                  : miss(),
            )
          }
        />:null
      )}{" "}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <button
        className="undo-link"
        onClick={() => void undo()}
      >
        {t.undo}
      </button>
      <Dialog open={Boolean(dialog)} title={dialog?.title ?? ""} description={dialog?.description ?? ""} confirmLabel={dialog?.confirmLabel ?? "Подтвердить"} destructive={Boolean(dialog?.destructive)} onCancel={() => setDialog(undefined)} onConfirm={() => { dialog?.action(); }} />
    </main>
  );
}

function Summary({
  snapshot,
  players,
  previousMatches,
  onUndo,
  onFinish,
}: {
  snapshot: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onUndo: () => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const m = snapshot.match;
  const view = toGameViewModel(snapshot, players);
  const records = m.players.flatMap((playerId) => {
    const player = players.find((item) => item.id === playerId);
    return newRecordsForMatch(m, previousMatches, playerId).map((record) => ({ ...record, playerName: player?.name ?? "Игрок" }));
  });
  return (
    <main className="summary-page">
      <p className="eyeline">{view.summaryEyeline}</p>
      <h1>{view.summaryTitle}</h1>
      <Scoreboard rows={view.scoreboard} />
      {records.length > 0 ? <section className="new-records"><h2>🏆 Новый личный рекорд</h2>{records.map((record) => <p key={`${record.playerName}-${record.key}`}><span>{record.playerName} · {record.label}</span><strong>{record.percent ? `${record.value.toFixed(1)}%` : Number.isInteger(record.value) ? record.value : record.value.toFixed(1)}</strong></p>)}</section> : null}
      <section className="summary-actions">
        <button
          className="secondary"
          onClick={() =>
            void onUndo().catch((e) =>
              setError(e instanceof Error ? e.message : "Ошибка сохранения"),
            )
          }
        >
          {t.undo}
        </button>
        <button
          className="primary"
          onClick={() =>
            void onFinish().catch((e) =>
              setError(e instanceof Error ? e.message : "Ошибка сохранения"),
            )
          }
        >
          {t.finish}
        </button>
      </section>
      {error ? <div className="error" role="alert">{error}</div> : null}
    </main>
  );
}
