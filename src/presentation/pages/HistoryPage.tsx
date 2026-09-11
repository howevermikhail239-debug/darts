import { useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
import { notationOf } from "../../domain/darts/DartThrow";
import { t } from "../strings";
import { PlayerIdentity } from "../components/PlayerIdentity";
import { Dialog } from "../components/Dialog";
import { DartboardHeatmap } from "../components/DartboardHeatmap";
import { userMessage } from "../errors/userMessage";

/** Размер страницы истории (PERF-7): раньше список рендерился целиком. */
const PAGE_SIZE = 20;

/**
 * UI-3. История намеренно показывает имя НА МОМЕНТ МАТЧА: это снимок, и он не
 * должен переписываться задним числом. Но игра и статистика показывают
 * актуальное имя профиля, и после переименования экраны расходились без
 * объяснения. Теперь расхождение видно прямо в строке: «Миша (сейчас Михаил)».
 */
const nameOf = (match: Match, id: PlayerId) => match.participantNames[id] ?? "Игрок";
const currentNameOf = (match: Match, players: readonly Player[], id: PlayerId): string | undefined => {
  const current = players.find((player) => player.id === id)?.name;
  return current && current !== nameOf(match, id) ? current : undefined;
};
const labelOf = (match: Match, players: readonly Player[], id: PlayerId): string => {
  const current = currentNameOf(match, players, id);
  return current ? `${nameOf(match, id)} (сейчас ${current})` : nameOf(match, id);
};

const dayKey = (value: string) => new Date(value).toLocaleDateString("en-CA");
const dayLabel = (value: string) => {
  const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "Сегодня";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

export function HistoryPage({ matches, players, persistentPlayerIds, onBack, onRematch, onDelete }: { matches: readonly Match[]; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onBack: () => void; onRematch: (match: Match) => Promise<void>; onDelete: (matchId: string) => Promise<void> }) {
  // PERF-7: постраничная подгрузка вместо рендеринга всей истории разом.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = useMemo(() => matches.slice(0, visibleCount), [matches, visibleCount]);
  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; matches: Match[] }> = [], byDay = new Map<string, Match[]>();
    for (const match of visible) {
      const key = dayKey(match.createdAt), existing = byDay.get(key);
      if (existing) existing.push(match); else { const groupMatches = [match]; byDay.set(key, groupMatches); result.push({ key, label: dayLabel(match.createdAt), matches: groupMatches }); }
    }
    return result;
  }, [visible]);
  const remaining = matches.length - visible.length;
  return <main className="history-page">
    <header><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><h1>{t.history}</h1></header>
    {matches.length === 0 ? <p className="empty">Здесь появятся сыгранные матчи.</p> : groups.map((group) => <section className="history-day" key={group.key}><h2>{group.label}</h2>{group.matches.map((match) => <HistoryMatch key={match.id} match={match} players={players} persistentPlayerIds={persistentPlayerIds} onRematch={onRematch} onDelete={onDelete} />)}</section>)}
    {remaining > 0 ? <div className="history-more"><button className="secondary" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}>Показать ещё</button><small>Показано {visible.length} из {matches.length}</small></div> : null}
  </main>;
}

function HistoryMatch({ match, players, persistentPlayerIds, onRematch, onDelete }: { match: Match; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onRematch: (match: Match) => Promise<void>; onDelete: (matchId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const playerNames = match.players.map((id) => labelOf(match, players, id));
  const winner = match.winnerId ? labelOf(match, players, match.winnerId) : undefined;
  const mode = match.state.kind === "x01" ? `X01 · ${match.state.startingScore}` : `Серия · ${match.state.visitsPerPlayer} подходов`;
  const result = match.players.map((id) => match.state.kind === "x01" ? match.state.remaining[id] : match.state.totals[id]).join(" : ");
  return <details className="history-match" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><div><b>{playerNames.join(" — ")}</b><span>{mode} · {new Date(match.createdAt).toLocaleDateString("ru-RU")}</span><span className={match.status === "abandoned" ? "history-status abandoned" : "history-status"}>{match.status === "abandoned" ? "Матч прерван" : winner ? `Победитель: ${winner}` : "Ничья"}</span></div><strong>{result}</strong></summary>
    {open ? <HistoryDetail match={match} players={players} persistentPlayerIds={persistentPlayerIds} onRematch={async (source) => { setError(undefined); try { await onRematch(source); } catch (cause) { setError(userMessage(cause, "Не удалось начать новый матч.")); } }} onDelete={() => setConfirmDelete(true)} busy={busy} /> : null}
    {error ? <div className="error" role="alert">{error}</div> : null}
    <Dialog open={confirmDelete} title="Удалить этот матч?" description="Матч исчезнет из истории, а вся зависимая статистика будет пересчитана." confirmLabel="Удалить матч" destructive onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); setBusy(true); void onDelete(match.id).catch((cause: unknown) => setError(userMessage(cause, "Не удалось удалить матч."))).finally(() => setBusy(false)); }} />
  </details>;
}

function HistoryDetail({ match, players, persistentPlayerIds, onRematch, onDelete, busy }: { match: Match; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onRematch: (match: Match) => Promise<void>; onDelete: () => void; busy: boolean }) {
  // PERF-5: статистика матча считается один раз на раскрытую карточку, а не на каждый рендер.
  const stats = useMemo(() => statisticsForMatch(match), [match]);
  return <div className="history-detail"><h3>Подробности матча</h3>{match.players.map((id, index) => { const current = currentNameOf(match, players, id); return <div className="history-player" key={id}><PlayerIdentity playerId={id} name={nameOf(match, id)} temporary={!persistentPlayerIds.includes(id)} position={index} compact />{current ? <small className="history-renamed">сейчас {current}</small> : null}<span>среднее {stats[id]?.averagePerVisit.toFixed(1)} · лучший {stats[id]?.bestVisit} · дротиков {stats[id]?.physicalDarts}</span></div>; })}<ol>{match.confirmedVisits.map((visit) => <li key={visit.id}>{nameOf(match, visit.playerId)}: {visit.inputKind === "aggregate" ? `Сумма подхода: ${visit.aggregateScore}` : visit.darts.map(notationOf).join(" · ")} = {visit.rawScore}{visit.result === "bust" ? " (перебор)" : ""}</li>)}</ol>{match.players.map((id) => <DartboardHeatmap key={id} label={`Попадания ${nameOf(match, id)} в этом матче`} hitCounts={stats[id]?.hitCounts ?? {}} detailedDarts={stats[id]?.knownHitDarts ?? 0} />)}{match.status === "completed" ? <div className="history-actions"><button className="secondary history-rematch" disabled={busy} onClick={() => void onRematch(match)}>Сыграть ещё раз</button><button className="danger-button" disabled={busy} onClick={onDelete}>Удалить матч</button></div> : null}</div>;
}
