import { useEffect, useMemo, useState } from 'react';
import { bull, miss, numberThrow, outerBull, type Multiplier } from '../../domain/darts/DartThrow';
import type { Match, Player } from '../../domain/match/models';
import { newRecordsForMatch } from '../../domain/statistics/StatisticsCalculator';
import type { GameSession, SessionSnapshot } from '../../application/GameSession';
import { useWakeLock } from '../hooks/useWakeLock';
import { Scoreboard } from '../components/Scoreboard';
import { DraftPanel } from '../components/DraftPanel';
import { DartPad } from '../components/DartPad';
import { t } from '../strings';
import { draftIsEmpty, isDetailedDraft } from '../../domain/match/VisitDraft';
import { toGameViewModel } from '../game/gameViewModel';
import { Dialog } from '../components/Dialog';
import { vibrateFor, type HapticEvent } from '../feedback/haptics';
import { PlayerIdentity } from '../components/PlayerIdentity';
import { toSummaryViewModel } from '../game/summaryViewModel';
import { prepareResultShare } from '../../application/PrepareResultShare';
import { notationOf } from '../../domain/darts/DartThrow';
import { currentStreak } from '../../domain/statistics/todaySummary';
import { userMessage } from '../errors/userMessage';
type PendingDialog = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: () => void;
};
type Props = {
  session: GameSession;
  initial: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onChange: (s: SessionSnapshot) => void;
  onBack: () => void;
  onClosed: () => void;
  onStatistics: (match: Match) => Promise<void>;
  onRematch: (match: Match) => Promise<void>;
  persistentPlayerIds: readonly string[];
  hapticsEnabled: boolean;
};
export function GamePage({
  session,
  initial,
  players,
  previousMatches,
  onChange,
  onBack,
  onClosed,
  onStatistics,
  onRematch,
  persistentPlayerIds,
  hapticsEnabled,
}: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [multiplier, setMultiplier] = useState<Multiplier>(1);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<PendingDialog>();
  const [feedback, setFeedback] = useState<{ key: number; kind: HapticEvent; playerName: string }>();
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(undefined), feedback.kind === 'maximum' ? 1100 : 650);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  useWakeLock(snapshot.match.status === 'in_progress');
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
      setError(userMessage(e));
    }
  };
  const undo = async () => {
    try {
      const hasDraft = !draftIsEmpty(snapshot.draft);
      if (hasDraft) {
        setDialog({
          title: 'Отменить предыдущий подход?',
          description: 'Текущий незавершённый подход будет сброшен. Это действие нельзя отменить.',
          confirmLabel: 'Сбросить и отменить',
          destructive: true,
          action: () => {
            setDialog(undefined);
            void undoConfirmed(true);
          },
        });
        return;
      }
      await undoConfirmed(false);
    } catch (e) {
      setError(userMessage(e));
    }
  };
  const undoConfirmed = async (discardDraft: boolean) => {
    try {
      update(await session.undo(discardDraft));
      setSelected(undefined);
      setMultiplier(1);
    } catch (e) {
      setError(userMessage(e));
    }
  };
  const changeInputMode = (mode: 'detailed' | 'aggregate') => {
    const apply = (discard: boolean) =>
      void session
        .setInputMode(mode, discard)
        .then(update)
        .catch((e) => setError(userMessage(e)));
    if (draftIsEmpty(snapshot.draft)) {
      apply(false);
      return;
    }
    setDialog({
      title: 'Переключить способ ввода?',
      description: 'Текущий незавершённый подход будет сброшен.',
      confirmLabel: 'Сбросить и переключить',
      destructive: true,
      action: () => {
        setDialog(undefined);
        apply(true);
      },
    });
  };
  const confirm = async () => {
    try {
      const visitCount = snapshot.match.confirmedVisits.length;
      const playerName = toGameViewModel(snapshot, players, persistentPlayerIds).currentPlayerName;
      const pending = session.confirm();
      update(session.snapshot());
      const next = await pending;
      update(next);
      const visit = next.match.confirmedVisits.length > visitCount ? next.match.confirmedVisits.at(-1) : undefined;
      if (visit) {
        const kind: HapticEvent =
          next.match.status === 'completed'
            ? 'win'
            : visit.result === 'bust'
              ? 'bust'
              : visit.awardedScore === 180
                ? 'maximum'
                : 'confirm';
        vibrateFor(kind, hapticsEnabled);
        setFeedback({ key: Date.now(), kind, playerName });
      }
    } catch (e) {
      update(session.snapshot());
      setError(userMessage(e));
    }
  };
  // PERF-5: тяжёлая часть модели — статистика матча — кэшируется по ссылке на матч
  // внутри `toGameViewModel`, поэтому повторный вызов на рендере дешёвый.
  const view = toGameViewModel(snapshot, players, persistentPlayerIds);
  const undoVisit = snapshot.undoVisit;
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
        onStatistics={async () => {
          await session.finalize();
          await onStatistics(snapshot.match);
        }}
        onRematch={() => onRematch(snapshot.match)}
        persistentPlayers={players.filter((player) => persistentPlayerIds.includes(player.id))}
      />
    );
  return (
    <main className="game-page">
      <header className="game-header">
        <button className="text-icon" onClick={onBack} aria-label="На главный экран">
          ‹
        </button>
        <div>
          <strong>{view.title}</strong>
          <span>{view.phaseLabel}</span>
        </div>
        <button
          className="text-icon"
          onClick={() =>
            setDialog({
              title: 'Прервать матч?',
              description:
                'Незавершённый подход не попадёт в историю. Подтверждённые результаты сохранятся как прерванный матч.',
              confirmLabel: 'Прервать матч',
              destructive: true,
              action: () => {
                setDialog(undefined);
                void session
                  .abandon()
                  .then(onClosed)
                  .catch((e) => setError(userMessage(e)));
              },
            })
          }
          aria-label={t.abandon}
        >
          ×
        </button>
      </header>
      <Scoreboard rows={view.scoreboard} />
      {feedback?.kind === 'maximum' ? (
        <div key={feedback.key} className="maximum-celebration" role="status" aria-live="polite">
          <div className="particles" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <strong>180</strong>
          <span>МАКСИМУМ · {feedback.playerName}</span>
        </div>
      ) : feedback?.kind === 'bust' ? (
        <div key={feedback.key} className="bust-feedback" role="status">
          Перебор — счёт не изменился
        </div>
      ) : null}
      <div className="current-label">
        ● {t.currentVisit}: <strong>{view.currentPlayerName}</strong>
      </div>
      <div className="segments input-mode" aria-label="Способ ввода">
        <button
          type="button"
          className={isDetailedDraft(snapshot.draft) ? 'selected' : ''}
          aria-pressed={isDetailedDraft(snapshot.draft)}
          onClick={() => changeInputMode('detailed')}
        >
          По дротикам
        </button>
        <button
          type="button"
          className={!isDetailedDraft(snapshot.draft) ? 'selected' : ''}
          aria-pressed={!isDetailedDraft(snapshot.draft)}
          onClick={() => changeInputMode('aggregate')}
        >
          Суммой за подход
        </button>
      </div>
      {!isDetailedDraft(snapshot.draft) ? (
        <label className="aggregate-input">
          Сумма за подход
          <input
            type="number"
            min="0"
            max="180"
            step="1"
            value={snapshot.draft.score ?? ''}
            onChange={(event) => {
              const value = event.target.value === '' ? undefined : Number(event.target.value);
              void session
                .setAggregateScore(value)
                .then(update)
                .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка сохранения'));
            }}
          />
        </label>
      ) : null}
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
            setError(userMessage(e));
          });
        }}
        onReset={() => {
          const pending = session.reset();
          update(session.snapshot());
          void pending
            .then((value) => {
              update(value);
              setMultiplier(1);
              setSelected(undefined);
            })
            .catch((e) => {
              update(session.snapshot());
              setError(userMessage(e));
            });
        }}
        onConfirm={() => void confirm()}
      />
      {view.checkoutHint ? (
        <div className="checkout" role="status">
          <span>Возможное закрытие</span>
          <strong>{view.checkoutHint}</strong>
        </div>
      ) : null}
      {view.awaitingTieDecision ? (
        <div className="tie-panel">
          <h2>{t.draw}</h2>
          <button
            className="primary"
            onClick={() =>
              void session
                .extraRound()
                .then(update)
                .catch((e) => setError(userMessage(e)))
            }
          >
            {t.extra}
          </button>
          {view.canCompleteDraw ? (
            <button
              className="secondary"
              onClick={() =>
                void session
                  .completeDraw()
                  .then(update)
                  .catch((e) => setError(userMessage(e)))
              }
            >
              {t.finishDraw}
            </button>
          ) : null}
        </div>
      ) : isDetailedDraft(snapshot.draft) ? (
        <DartPad
          multiplier={multiplier}
          disabled={
            snapshot.isConfirming || snapshot.isPersistingDraft || (!view.canAddNextDart && selected === undefined)
          }
          onMultiplier={setMultiplier}
          onNumber={(n) => void enter(numberThrow(n, multiplier))}
          onBull={(kind) => void enter(kind === 'outer' ? outerBull() : kind === 'bull' ? bull() : miss())}
        />
      ) : null}{' '}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <button className="undo-link" aria-label={t.undo} onClick={() => void undo()} disabled={!undoVisit}>
        {undoVisit
          ? `Отменить: ${snapshot.match.participantNames[undoVisit.playerId] ?? 'Игрок'} · ${undoVisit.awardedScore}`
          : t.undo}
      </button>
      {undoVisit && undoVisit.inputKind !== 'aggregate' ? (
        <small className="undo-preview">{undoVisit.darts.map(notationOf).join(' · ')}</small>
      ) : null}
      <Dialog
        open={Boolean(dialog)}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmLabel={dialog?.confirmLabel ?? 'Подтвердить'}
        destructive={Boolean(dialog?.destructive)}
        onCancel={() => setDialog(undefined)}
        onConfirm={() => {
          dialog?.action();
        }}
      />
    </main>
  );
}

function Summary({
  snapshot,
  players,
  previousMatches,
  onUndo,
  onFinish,
  onStatistics,
  onRematch,
  persistentPlayers,
}: {
  snapshot: SessionSnapshot;
  players: readonly Player[];
  previousMatches: readonly Match[];
  onUndo: () => Promise<void>;
  onFinish: () => Promise<void>;
  onStatistics: () => Promise<void>;
  onRematch: () => Promise<void>;
  persistentPlayers: readonly Player[];
}) {
  const [error, setError] = useState<string>();
  const [shareNote, setShareNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const m = snapshot.match;
  const view = toGameViewModel(
    snapshot,
    players,
    persistentPlayers.map((player) => player.id),
  );
  const summary = useMemo(() => toSummaryViewModel(m, persistentPlayers), [m, persistentPlayers]);
  const records = useMemo(
    () =>
      m.players
        .filter((playerId) => persistentPlayers.some((player) => player.id === playerId))
        .flatMap((playerId) => {
          const player = persistentPlayers.find((item) => item.id === playerId);
          return newRecordsForMatch(m, previousMatches, playerId, player?.statsResetAt).map((record) => ({
            ...record,
            playerName: player?.name ?? 'Игрок',
          }));
        }),
    [m, persistentPlayers, previousMatches],
  );
  const streaks = useMemo(
    () =>
      persistentPlayers.flatMap((player) => {
        const streak = currentStreak([...previousMatches, m], player.id, player.statsResetAt);
        return streak?.result === 'win' && streak.count >= 2 ? [{ name: player.name, count: streak.count }] : [];
      }),
    [m, persistentPlayers, previousMatches],
  );
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(userMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setShareNote(undefined);
    try {
      const { shareResultCard } = await import('../../infrastructure/share/BrowserResultShare');
      const outcome = await shareResultCard(prepareResultShare(m, players));
      if (outcome === 'downloaded') setShareNote('PNG-карточка сохранена на устройство.');
      else if (outcome === 'shared') setShareNote('Карточка передана в меню «Поделиться».');
    } catch {
      setError('Не удалось подготовить карточку. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="summary-page">
      <p className="eyeline">{view.summaryEyeline}</p>
      <h1>{summary.title}</h1>
      {summary.winner ? (
        <div className="summary-winner">
          <PlayerIdentity {...summary.winner} />
        </div>
      ) : (
        <p className="summary-draw">Результат разделили несколько игроков</p>
      )}
      <section className="summary-facts" aria-label="Главные факты матча">
        {summary.facts.map((fact) => (
          <article key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </article>
        ))}
      </section>
      <Scoreboard rows={view.scoreboard} />
      {summary.maximums > 0 ? <p className="summary-achievement">180 МАКСИМУМ · {summary.maximums}</p> : null}
      {streaks.map((streak) => (
        <p className="summary-achievement" key={streak.name}>
          🔥 {streak.name}: {streak.count}-я победа подряд
        </p>
      ))}
      {records.length > 0 ? (
        <section className="new-records">
          <h2>🏅 Новый личный рекорд</h2>
          {records.map((record) => (
            <p key={`${record.playerName}-${record.key}`}>
              <span>
                {record.playerName} · {record.label}
                <small>
                  Предыдущий:{' '}
                  {record.percent
                    ? `${record.previous.toFixed(1)}%`
                    : Number.isInteger(record.previous)
                      ? record.previous
                      : record.previous.toFixed(1)}
                </small>
              </span>
              <strong>
                {record.percent
                  ? `${record.value.toFixed(1)}%`
                  : Number.isInteger(record.value)
                    ? record.value
                    : record.value.toFixed(1)}
              </strong>
            </p>
          ))}
        </section>
      ) : null}
      <section className="summary-actions">
        <button className="primary" disabled={busy} onClick={() => void run(onRematch)}>
          Сыграть ещё раз
        </button>
        {persistentPlayers.length > 0 ? (
          <button className="secondary" disabled={busy} onClick={() => void run(onStatistics)}>
            Статистика
          </button>
        ) : null}
        <button className="secondary share-result" disabled={busy} onClick={() => void share()}>
          Поделиться
        </button>
        <button className="secondary" disabled={busy} onClick={() => void run(onFinish)}>
          На главную
        </button>
        <button className="secondary" disabled={busy} onClick={() => void run(onUndo)}>
          {t.undo}
        </button>
      </section>
      {shareNote ? (
        <p className="share-note" role="status">
          {shareNote}
        </p>
      ) : null}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
    </main>
  );
}
