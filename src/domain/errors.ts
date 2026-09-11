export type DomainErrorCode =
  | 'draft_not_reset'
  | 'busy_confirming'
  | 'busy_persisting'
  | 'nothing_to_undo'
  | 'match_finished'
  | 'draw_not_pending'
  | 'draw_too_early'
  | 'extra_round_unavailable'
  | 'player_limits'
  | 'visits_range'
  | 'profile_missing'
  | 'requires_connection'
  | 'rematch_requires_completed'
  | 'backup_invalid'
  | 'invalid_remaining'
  | 'invalid_total'
  | 'wrong_rules_for_mode'
  | 'visit_player_mismatch'
  | 'leader_undetermined'
  | 'invalid_player_index';

export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const domainError = (code: DomainErrorCode, message: string): DomainError => new DomainError(code, message);
