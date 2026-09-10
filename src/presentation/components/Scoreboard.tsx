import type { Match, Player } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
type Props = { match: Match; players: readonly Player[] };
export function Scoreboard({ match, players }: Props) {
  const stats = statisticsForMatch(match);
  return (
    <section
      className={`scoreboard ${match.players.length > 2 ? "multi" : ""}`}
      aria-label="Счёт игроков"
    >
      {match.players.map((id, index) => {
        const player = players.find((p) => p.id === id);
        const active = index === match.currentPlayerIndex;
        const score =
          match.state.kind === "x01"
            ? match.state.remaining[id]
            : match.state.totals[id];
        const last = match.confirmedVisits
          .filter((v) => v.playerId === id)
          .at(-1);
        return (
          <article
            key={id}
            className={`player-score ${active ? "active" : ""}`}
            aria-current={active ? "true" : undefined}
          >
            {active ? (
              <span className="turn-mark">● ХОД</span>
            ) : (
              <span className="turn-spacer" />
            )}
            <div className="player-head">
              <h2>{player?.name ?? "Игрок"}</h2>
            </div>
            <div className="main-score">{score ?? 0}</div>
            <div className="mini-stats">
              <span>
                Среднее <b>{stats[id]?.averagePerVisit.toFixed(1) ?? "0,0"}</b>
              </span>
              <span>
                Последний <b>{last?.awardedScore ?? "—"}</b>
              </span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
