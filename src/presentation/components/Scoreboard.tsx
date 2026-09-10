import type { ScoreboardRowViewModel } from "../game/gameViewModel";
type Props = { rows: readonly ScoreboardRowViewModel[] };
export function Scoreboard({ rows }: Props) {
  return (
    <section
      className={`scoreboard ${rows.length > 2 ? "multi" : ""}`}
      aria-label="Счёт игроков"
    >
      {rows.map((row) => {
        return (
          <article
            key={row.playerId}
            className={`player-score ${row.active ? "active" : ""}`}
            aria-current={row.active ? "true" : undefined}
          >
            {row.active ? (
              <span className="turn-mark">● ХОД</span>
            ) : (
              <span className="turn-spacer" />
            )}
            <div className="player-head">
              <h2>{row.name}</h2>
            </div>
            <div className="main-score">{row.score}</div>
            <div className="mini-stats">
              <span>
                Среднее <b>{row.average}</b>
              </span>
              <span>
                Последний <b>{row.lastScore}</b>
              </span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
