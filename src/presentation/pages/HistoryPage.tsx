import type { Match, Player, PlayerId } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
import { notationOf } from "../../domain/darts/DartThrow";
import { t } from "../strings";

const nameOf = (match: Match, players: readonly Player[], id: PlayerId) => players.find((player) => player.id === id)?.name ?? match.participantNames[id] ?? "Игрок";

export function HistoryPage({ matches, players, onBack }: { matches: readonly Match[]; players: readonly Player[]; onBack: () => void }) {
  return <main className="history-page">
    <header><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><h1>{t.history}</h1></header>
    {matches.length === 0 ? <p className="empty">{t.empty}</p> : matches.map((match) => {
      const stats = statisticsForMatch(match);
      const playerNames = match.players.map((id) => nameOf(match, players, id));
      const winner = match.winnerId ? nameOf(match, players, match.winnerId) : undefined;
      const mode = match.state.kind === "x01" ? `X01 · ${match.state.startingScore}` : `Серия · ${match.state.visitsPerPlayer} подходов`;
      const result = match.players.map((id) => match.state.kind === "x01" ? match.state.remaining[id] : match.state.totals[id]).join(" : ");
      return <details key={match.id} className="history-match">
        <summary><div><b>{playerNames.join(" — ")}</b><span>{mode} · {new Date(match.createdAt).toLocaleDateString("ru-RU")}</span><span className={match.status === "abandoned" ? "history-status abandoned" : "history-status"}>{match.status === "abandoned" ? "Матч прерван" : winner ? `Победитель: ${winner}` : "Ничья"}</span></div><strong>{result}</strong></summary>
        <div className="history-detail"><h2>Подробности матча</h2>{match.players.map((id) => <p key={id}><b>{nameOf(match, players, id)}</b>: среднее {stats[id]?.averagePerVisit.toFixed(1)}, лучший подход {stats[id]?.bestVisit}, дротиков {stats[id]?.physicalDarts}</p>)}<ol>{match.confirmedVisits.map((visit) => <li key={visit.id}>{nameOf(match, players, visit.playerId)}: {visit.inputKind === "aggregate" ? `Сумма подхода: ${visit.aggregateScore}` : visit.darts.map(notationOf).join(" · ")} = {visit.rawScore}{visit.result === "bust" ? " (перебор)" : ""}</li>)}</ol></div>
      </details>;
    })}
  </main>;
}
