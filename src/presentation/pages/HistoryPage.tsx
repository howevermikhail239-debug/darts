import { useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
import { notationOf } from "../../domain/darts/DartThrow";
import { t } from "../strings";
import { PlayerIdentity } from "../components/PlayerIdentity";
import { Dialog } from "../components/Dialog";
import { DartboardHeatmap } from "../components/DartboardHeatmap";

const nameOf = (match: Match, _players: readonly Player[], id: PlayerId) => match.participantNames[id] ?? "Игрок";

const dayKey = (value: string) => new Date(value).toLocaleDateString("en-CA");
const dayLabel = (value: string) => {
  const date = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "Сегодня";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

export function HistoryPage({ matches, players, persistentPlayerIds, onBack, onRematch, onDelete }: { matches: readonly Match[]; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onBack: () => void; onRematch: (match: Match) => Promise<void>; onDelete: (matchId: string) => Promise<void> }) {
  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; matches: Match[] }> = [], byDay = new Map<string, Match[]>();
    for (const match of matches) {
      const key = dayKey(match.createdAt), existing = byDay.get(key);
      if (existing) existing.push(match); else { const groupMatches = [match]; byDay.set(key, groupMatches); result.push({ key, label: dayLabel(match.createdAt), matches: groupMatches }); }
    }
    return result;
  }, [matches]);
  return <main className="history-page">
    <header><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><h1>{t.history}</h1></header>
    {matches.length === 0 ? <p className="empty">Здесь появятся сыгранные матчи.</p> : groups.map((group) => <section className="history-day" key={group.key}><h2>{group.label}</h2>{group.matches.map((match) => <HistoryMatch key={match.id} match={match} players={players} persistentPlayerIds={persistentPlayerIds} onRematch={onRematch} onDelete={onDelete} />)}</section>)}
  </main>;
}

function HistoryMatch({ match, players, persistentPlayerIds, onRematch, onDelete }: { match: Match; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onRematch: (match: Match) => Promise<void>; onDelete: (matchId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const playerNames = match.players.map((id) => nameOf(match, players, id));
  const winner = match.winnerId ? nameOf(match, players, match.winnerId) : undefined;
  const mode = match.state.kind === "x01" ? `X01 · ${match.state.startingScore}` : `Серия · ${match.state.visitsPerPlayer} подходов`;
  const result = match.players.map((id) => match.state.kind === "x01" ? match.state.remaining[id] : match.state.totals[id]).join(" : ");
  return <details className="history-match" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><div><b>{playerNames.join(" — ")}</b><span>{mode} · {new Date(match.createdAt).toLocaleDateString("ru-RU")}</span><span className={match.status === "abandoned" ? "history-status abandoned" : "history-status"}>{match.status === "abandoned" ? "Матч прерван" : winner ? `Победитель: ${winner}` : "Ничья"}</span></div><strong>{result}</strong></summary>
    {open ? <HistoryDetail match={match} players={players} persistentPlayerIds={persistentPlayerIds} onRematch={onRematch} onDelete={() => setConfirmDelete(true)} busy={busy} /> : null}
    {error ? <div className="error" role="alert">{error}</div> : null}
    <Dialog open={confirmDelete} title="Удалить этот матч?" description="Матч исчезнет из истории, а вся зависимая статистика будет пересчитана." confirmLabel="Удалить матч" destructive onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); setBusy(true); void onDelete(match.id).catch((e: unknown) => setError(e instanceof Error ? e.message : "Не удалось удалить матч.")).finally(() => setBusy(false)); }} />
  </details>;
}

function HistoryDetail({ match, players, persistentPlayerIds, onRematch, onDelete, busy }: { match: Match; players: readonly Player[]; persistentPlayerIds: readonly PlayerId[]; onRematch: (match: Match) => Promise<void>; onDelete: () => void; busy: boolean }) {
  const stats = statisticsForMatch(match);
  return <div className="history-detail"><h3>Подробности матча</h3>{match.players.map((id, index) => <div className="history-player" key={id}><PlayerIdentity playerId={id} name={nameOf(match, players, id)} temporary={!persistentPlayerIds.includes(id)} position={index} compact /><span>среднее {stats[id]?.averagePerVisit.toFixed(1)} · лучший {stats[id]?.bestVisit} · дротиков {stats[id]?.physicalDarts}</span></div>)}<ol>{match.confirmedVisits.map((visit) => <li key={visit.id}>{nameOf(match, players, visit.playerId)}: {visit.inputKind === "aggregate" ? `Сумма подхода: ${visit.aggregateScore}` : visit.darts.map(notationOf).join(" · ")} = {visit.rawScore}{visit.result === "bust" ? " (перебор)" : ""}</li>)}</ol>{match.players.map((id) => <DartboardHeatmap key={id} label={`Попадания ${nameOf(match, players, id)} в этом матче`} hitCounts={stats[id]?.hitCounts ?? {}} detailedDarts={stats[id]?.knownHitDarts ?? 0} />)}{match.status === "completed" ? <div className="history-actions"><button className="secondary history-rematch" disabled={busy} onClick={() => void onRematch(match)}>Сыграть ещё раз</button><button className="danger-button" disabled={busy} onClick={onDelete}>Удалить матч</button></div> : null}</div>;
}
