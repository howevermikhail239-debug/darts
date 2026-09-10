import type { DartThrow } from '../darts/DartThrow';

export type PlayerId = string;
export type MatchId = string;
export type MatchStatus = 'in_progress'|'completed'|'abandoned';
export type Player = Readonly<{ id: PlayerId; name: string; createdAt: string }>;
export type VisitResult = 'scored'|'bust'|'match_won'|'tie_pending';
export type VisitContext = Readonly<{ scores: Readonly<Record<PlayerId, number>>; currentPlayerIndex: number }>;
type VisitBase = Readonly<{
  id: string; matchId: MatchId; playerId: PlayerId; visitIndex: number;
  physicalDartsUsed: number; rawScore: number; awardedScore: number;
  before: VisitContext; after: VisitContext; result: VisitResult; timestamp: string;
}>;
export type DetailedVisit = VisitBase & Readonly<{
  inputKind?: 'detailed';
  darts: readonly DartThrow[];
}>;
export type AggregateVisit = VisitBase & Readonly<{
  inputKind: 'aggregate';
  aggregateScore: number;
}>;
export type Visit = DetailedVisit | AggregateVisit;
export const isDetailedVisit = (visit: Visit): visit is DetailedVisit => visit.inputKind !== 'aggregate';
export type X01Format =
  | Readonly<{ kind: 'unlimited' }>
  | Readonly<{ kind: 'limited'; visitsPerPlayer: number }>;
export type X01Phase =
  | Readonly<{ kind: 'regulation' }>
  | Readonly<{ kind: 'awaiting_tie_break'; playerIds: readonly PlayerId[]; round: number }>
  | Readonly<{
      kind: 'tie_break';
      playerIds: readonly PlayerId[];
      completedPlayerIds: readonly PlayerId[];
      roundScores: Readonly<Record<PlayerId, number>>;
      round: number;
    }>;
export type X01State = Readonly<{
  kind: 'x01'; startingScore: 301 | 501 | 701; outRule: 'straight' | 'double';
  format: X01Format; remaining: Readonly<Record<PlayerId, number>>;
  visitsCompleted: Readonly<Record<PlayerId, number>>; phase: X01Phase;
}>;
export type FixedVisitsPhase =
  | Readonly<{ kind: 'regulation' }>
  | Readonly<{ kind: 'awaiting_tie_decision'; round: number }>
  | Readonly<{ kind: 'extra_round'; round: number }>
  | Readonly<{ kind: 'completed_draw'; round: number }>;
export type FixedVisitsState = Readonly<{
  kind: 'fixed_visits'; visitsPerPlayer: number; totals: Readonly<Record<PlayerId, number>>;
  regulationCompleted: Readonly<Record<PlayerId, number>>; extraRoundsCompleted: number;
  phase: FixedVisitsPhase;
}>;
export type ModeState = X01State|FixedVisitsState;
export type Match = Readonly<{
  id: MatchId; createdAt: string; completedAt?: string; status: MatchStatus;
  players: readonly PlayerId[]; startingPlayerIndex: number; currentPlayerIndex: number;
  participantNames: Readonly<Record<PlayerId, string>>;
  state: ModeState; confirmedVisits: readonly Visit[]; winnerId?: PlayerId;
}>;

export const modeOf = (match: Match): ModeState['kind'] => match.state.kind;
export const participantName = (match: Match, playerId: PlayerId): string =>
  match.participantNames[playerId] ?? 'Игрок';

export const scoresOf = (match: Match): Readonly<Record<PlayerId, number>> => match.state.kind === 'x01' ? match.state.remaining : match.state.totals;
export const currentPlayerId = (match: Match): PlayerId => {
  const id = match.players[match.currentPlayerIndex];
  if (!id) throw new Error('Некорректный индекс игрока');
  return id;
};
export const visitContext = (match: Match): VisitContext => {
  const base = {
    scores: Object.freeze({ ...scoresOf(match) }),
    currentPlayerIndex: match.currentPlayerIndex,
  };
  return Object.freeze(base);
};
