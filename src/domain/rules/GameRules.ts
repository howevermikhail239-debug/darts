import type { VisitDraft } from '../match/VisitDraft';
import type { Match, Visit } from '../match/models';

export type DraftStatus = 'in_progress'|'invalid'|'ready_to_confirm'|'bust'|'match_won';
export type DraftEvaluation = Readonly<{
  status: DraftStatus; physicalDartsUsed: number; rawScore: number; awardedScore: number;
  canAddNextDart: boolean; remainingAfter?: number; reason?: string; validDartCount: number;
}>;
export interface GameRules {
  evaluateDraft(draft: VisitDraft, match: Match): DraftEvaluation;
  applyConfirmedVisit(visit: Visit, match: Match): Match;
  startExtraRound(match: Match): Match;
  completeDraw(match: Match, now: string): Match;
}
