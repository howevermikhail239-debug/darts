import { scoreOf, type DartThrow } from '../darts/DartThrow';
import { isReachableThreeDartScore } from './aggregateScore';
import type { Match } from './models';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
const dart = (v: unknown): v is DartThrow => record(v) && text(v.kind) && (
  (['miss', 'bull', 'outer_bull'].includes(v.kind) && only(v, ['kind'])) ||
  (v.kind === 'number' && only(v, ['kind', 'segment', 'multiplier']) && integer(v.segment) && v.segment >= 1 && v.segment <= 20 && [1, 2, 3].includes(Number(v.multiplier)))
);
const scores = (v: unknown, players: readonly string[], minimum = 0) => record(v) && players.every(id => integer(v[id]) && (v[id] as number) >= minimum);
const context = (v: unknown, players: readonly string[]) => record(v) && scores(v.scores, players) && integer(v.currentPlayerIndex) && v.currentPlayerIndex >= 0 && v.currentPlayerIndex < players.length;
const visit = (v: unknown, matchId: string, players: readonly string[]) => {
  if (!record(v) || !text(v.id) || v.matchId !== matchId || !text(v.playerId) || !players.includes(v.playerId) || !integer(v.visitIndex) || v.visitIndex < 0 || !integer(v.physicalDartsUsed) || v.physicalDartsUsed < 0 || !integer(v.rawScore) || v.rawScore < 0 || !integer(v.awardedScore) || v.awardedScore < 0 || !context(v.before, players) || !context(v.after, players) || !['scored', 'bust', 'match_won', 'tie_pending'].includes(String(v.result)) || !text(v.timestamp)) return false;
  if (v.inputKind === 'aggregate') return v.physicalDartsUsed === 3 && integer(v.aggregateScore) && v.aggregateScore === v.rawScore && isReachableThreeDartScore(v.aggregateScore) && v.darts === undefined;
  return (v.inputKind === undefined || v.inputKind === 'detailed') && Array.isArray(v.darts) && v.darts.length <= 3 && v.darts.every(dart) && v.physicalDartsUsed === v.darts.length && v.rawScore === v.darts.reduce((s, d) => s + scoreOf(d), 0);
};
export function isStoredMatch(v: unknown): v is Match {
  if (!record(v) || !text(v.id) || !text(v.createdAt) || !['in_progress', 'completed', 'abandoned'].includes(String(v.status)) || !ids(v.players) || v.players.length < 2 || v.players.length > 8 || new Set(v.players).size !== v.players.length || !integer(v.startingPlayerIndex) || v.startingPlayerIndex < 0 || v.startingPlayerIndex >= v.players.length || !integer(v.currentPlayerIndex) || v.currentPlayerIndex < 0 || v.currentPlayerIndex >= v.players.length || !record(v.participantNames) || !Array.isArray(v.confirmedVisits) || !record(v.state)) return false;
  const players = v.players; const names = v.participantNames; const matchId = v.id;
  if (!players.every(id => text(names[id])) || (v.winnerId !== undefined && (!text(v.winnerId) || !players.includes(v.winnerId))) || (v.status !== 'in_progress' && !text(v.completedAt)) || !v.confirmedVisits.every(x => visit(x, matchId, players))) return false;
  if (v.state.kind === 'x01') return [301, 501, 701].includes(Number(v.state.startingScore)) && ['straight', 'double'].includes(String(v.state.outRule)) && record(v.state.format) && (v.state.format.kind === 'unlimited' || (v.state.format.kind === 'limited' && integer(v.state.format.visitsPerPlayer) && v.state.format.visitsPerPlayer >= 1 && v.state.format.visitsPerPlayer <= 999)) && scores(v.state.remaining, players) && scores(v.state.visitsCompleted, players) && record(v.state.phase);
  return v.state.kind === 'fixed_visits' && integer(v.state.visitsPerPlayer) && v.state.visitsPerPlayer >= 1 && scores(v.state.totals, players) && scores(v.state.regulationCompleted, players) && integer(v.state.extraRoundsCompleted) && v.state.extraRoundsCompleted >= 0 && record(v.state.phase);
}
export function isSharedMatch(v: unknown): v is Match { return isStoredMatch(v) && v.status !== 'in_progress'; }
export function isSharedPlayer(v: unknown): v is { id: string; name: string; createdAt: string } { return record(v) && text(v.id) && text(v.name) && text(v.createdAt); }
