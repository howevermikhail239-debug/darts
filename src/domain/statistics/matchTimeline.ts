import type { Match, PlayerId, Visit } from '../match/models';

export type TimelineEventKind =
  | 'start'
  | 'visit'
  | 'high_score'
  | 'bust'
  | 'checkout_attempt'
  | 'checkout'
  | 'lead_change'
  | 'complete';
export type TimelineEvent = Readonly<{
  kind: TimelineEventKind;
  visitIndex?: number;
  playerId?: PlayerId;
  score?: number;
  at: string;
  remaining?: Readonly<Record<PlayerId, number>>;
}>;

const leaderOf = (scores: Readonly<Record<PlayerId, number>>, players: readonly PlayerId[]): PlayerId | undefined => {
  const minimum = Math.min(...players.map((id) => scores[id] ?? Number.POSITIVE_INFINITY));
  const leaders = players.filter((id) => scores[id] === minimum);
  return leaders.length === 1 ? leaders[0] : undefined;
};

function eventsForVisit(match: Match, visit: Visit, index: number): TimelineEvent[] {
  const base = { visitIndex: index + 1, playerId: visit.playerId, score: visit.awardedScore, at: visit.timestamp };
  const events: TimelineEvent[] = [{ kind: 'visit', ...base, remaining: visit.after.scores }];
  if (visit.result === 'bust') events.push({ kind: 'bust', ...base, remaining: visit.after.scores });
  if (visit.awardedScore >= 100) events.push({ kind: 'high_score', ...base, remaining: visit.after.scores });
  if (match.state.kind === 'x01' && (visit.before.scores[visit.playerId] ?? Infinity) <= 170)
    events.push({
      kind: visit.result === 'match_won' ? 'checkout' : 'checkout_attempt',
      ...base,
      remaining: visit.after.scores,
    });
  return events;
}

/** Event stream derived solely from confirmed visits; it stays correct after import, sync, and reload. */
export function matchTimeline(match: Match): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [{ kind: 'start', at: match.createdAt }];
  let leader =
    match.state.kind === 'x01'
      ? leaderOf(match.confirmedVisits[0]?.before.scores ?? match.state.remaining, match.players)
      : undefined;
  match.confirmedVisits.forEach((visit, index) => {
    events.push(...eventsForVisit(match, visit, index));
    if (match.state.kind !== 'x01') return;
    const nextLeader = leaderOf(visit.after.scores, match.players);
    if (nextLeader && nextLeader !== leader)
      events.push({
        kind: 'lead_change',
        visitIndex: index + 1,
        playerId: nextLeader,
        at: visit.timestamp,
        remaining: visit.after.scores,
      });
    leader = nextLeader;
  });
  if (match.status === 'completed')
    events.push({
      kind: 'complete',
      at: match.completedAt ?? match.createdAt,
      ...(match.winnerId ? { playerId: match.winnerId } : {}),
    });
  return events;
}
