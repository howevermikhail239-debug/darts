import type { ScoreboardRowViewModel } from "../game/gameViewModel";
import { useEffect, useRef } from "react";
import { PlayerIdentity } from "./PlayerIdentity";
type Props = { rows: readonly ScoreboardRowViewModel[] };
export function Scoreboard({ rows }: Props) {
  const active = useRef<HTMLElement>(null);
  const activeId = rows.find((row) => row.active)?.playerId;
  useEffect(() => {
    if (rows.length > 2) active.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [activeId, rows.length]);
  return (
    <section
      className={`scoreboard ${rows.length > 2 ? "multi" : ""}`}
      aria-label="Счёт игроков"
    >
      {rows.map((row) => {
        return (
          <article
            key={row.playerId}
            ref={row.active ? active : undefined}
            className={`player-score ${row.active ? "active" : ""}`}
            aria-current={row.active ? "true" : undefined}
          >
            {row.active ? (
              <span className="turn-mark"><span aria-hidden="true">●</span> ХОД</span>
            ) : (
              <span className="turn-spacer" />
            )}
            <div className="player-head">
              <h2><PlayerIdentity playerId={row.playerId} name={row.name} temporary={row.temporary} position={row.position} compact /></h2>
            </div>
            <div key={`${row.playerId}-${row.scoreRevision}-${row.score}`} className="main-score score-value">{row.score}</div>
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
