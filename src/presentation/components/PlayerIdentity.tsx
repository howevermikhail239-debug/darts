import type { PlayerId } from "../../domain/match/models";
import { playerMonogram, playerVisual } from "../players/playerVisuals";

export function PlayerIdentity({ playerId, name, temporary = false, position = 0, compact = false }: { playerId: PlayerId; name: string; temporary?: boolean; position?: number; compact?: boolean }) {
  const visual = playerVisual(playerId, temporary, position);
  return <span className={`player-identity tone-${visual.tone}${compact ? " compact" : ""}`}>
    <span className="player-monogram" aria-hidden="true">{playerMonogram(name)}</span>
    <span className="player-identity-name">{name}</span>
  </span>;
}
