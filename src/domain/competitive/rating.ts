import type { Match, PlayerId } from '../match/models';

export const INITIAL_RATING = 1500;
export type RatingEvent = Readonly<{
  matchId: string;
  playerId: PlayerId;
  before: number;
  after: number;
  delta: number;
  at: string;
}>;
export type RatingSummary = Readonly<{
  rating: number;
  peak: number;
  games: number;
  provisional: boolean;
  events: readonly RatingEvent[];
}>;

const expected = (own: number, opponent: number) => 1 / (1 + 10 ** ((opponent - own) / 400));
const round = (value: number) => Math.round(value);

/**
 * Производный рейтинг X01. Для матчей 3–8 игроков применяется pairwise модель:
 * победитель сравнивается с каждым соперником как победитель, остальные получают
 * между собой ничью — в Match нет достоверного полного порядка мест.
 */
export function ratingsForMatches(
  matches: readonly Match[],
  playerIds: readonly PlayerId[],
): ReadonlyMap<PlayerId, RatingSummary> {
  const state = new Map(
    playerIds.map((id) => [
      id,
      { rating: INITIAL_RATING, peak: INITIAL_RATING, games: 0, events: [] as RatingEvent[] },
    ]),
  );
  for (const match of [...matches].sort((a, b) =>
    (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt),
  )) {
    if (match.status !== 'completed' || match.state.kind !== 'x01' || !match.players.every((id) => state.has(id)))
      continue;
    const before = new Map(match.players.map((id) => [id, state.get(id)!.rating]));
    const deltas = new Map(match.players.map((id) => [id, 0]));
    for (let left = 0; left < match.players.length; left += 1)
      for (let right = left + 1; right < match.players.length; right += 1) {
        const a = match.players[left]!,
          b = match.players[right]!;
        const aWon = match.winnerId === a,
          bWon = match.winnerId === b;
        const scoreA = aWon ? 1 : bWon ? 0 : 0.5;
        const games = Math.max(state.get(a)!.games, state.get(b)!.games);
        const k = games < 10 ? 48 : 24;
        const change = k * (scoreA - expected(before.get(a)!, before.get(b)!));
        deltas.set(a, deltas.get(a)! + change);
        deltas.set(b, deltas.get(b)! - change);
      }
    for (const id of match.players) {
      const item = state.get(id)!;
      const after = round(item.rating + deltas.get(id)!);
      const event: RatingEvent = {
        matchId: match.id,
        playerId: id,
        before: item.rating,
        after,
        delta: after - item.rating,
        at: match.completedAt ?? match.createdAt,
      };
      item.rating = after;
      item.peak = Math.max(item.peak, after);
      item.games += 1;
      item.events.push(event);
    }
  }
  return new Map(
    [...state].map(([id, item]) => [
      id,
      { rating: item.rating, peak: item.peak, games: item.games, provisional: item.games < 10, events: item.events },
    ]),
  );
}
