import type { Match, PlayerId } from '../match/models';

export type IdentityLink = Readonly<{
  companyToken: string;
  companyPlayerId: string;
  verification: 'pending' | 'approved' | 'rejected' | 'revoked';
  claimId?: string;
  updatedAt: string;
}>;
export type PersonIdentity = Readonly<{
  id: string;
  primaryLocalPlayerId: PlayerId;
  createdAt: string;
  links: readonly IdentityLink[];
}>;

/** Match ids are canonical across the local history and company cache. On a conflict, prefer the newest completed snapshot. */
export function deduplicateIdentityMatches(matches: readonly Match[]): readonly Match[] {
  const byId = new Map<string, Match>();
  for (const match of matches) {
    const current = byId.get(match.id);
    if (!current || (match.completedAt ?? match.createdAt) > (current.completedAt ?? current.createdAt)) byId.set(match.id, match);
  }
  return [...byId.values()].sort((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt) || a.id.localeCompare(b.id));
}
