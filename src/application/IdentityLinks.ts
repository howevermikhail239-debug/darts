import type { CompanyGateway, IdentityClaim } from './ports/companyGateway';
import type { IdentityRepository } from './ports/repositories';
import type { PersonIdentity } from '../domain/identities/PersonIdentity';

const replaceLink = (identity: PersonIdentity, next: PersonIdentity['links'][number]): PersonIdentity => ({
  ...identity,
  links: [
    ...identity.links.filter(
      (link) => !(link.companyToken === next.companyToken && link.companyPlayerId === next.companyPlayerId),
    ),
    next,
  ],
});

export class IdentityLinks {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly gateway: CompanyGateway,
    private readonly id: () => string,
    private readonly now: () => string,
  ) {}
  async claim(
    companyToken: string,
    companyPlayerId: string,
    localPlayerId: string,
    displayName: string,
  ): Promise<PersonIdentity> {
    if (!this.gateway.createIdentityClaim) throw new Error('Эта версия сервера не поддерживает связи профилей.');
    const created = await this.gateway.createIdentityClaim(companyToken, companyPlayerId, displayName);
    const identities = await this.repository.listIdentities();
    const existing = identities.find((item) => item.primaryLocalPlayerId === localPlayerId) ?? {
      id: this.id(),
      primaryLocalPlayerId: localPlayerId,
      createdAt: this.now(),
      links: [],
    };
    const identity = replaceLink(existing, {
      companyToken,
      companyPlayerId,
      verification: 'pending',
      claimId: created.claim.id,
      claimKey: created.claimKey,
      updatedAt: this.now(),
    });
    await this.repository.saveIdentity(identity);
    return identity;
  }
  async refresh(identity: PersonIdentity, companyToken: string, companyPlayerId: string): Promise<PersonIdentity> {
    const link = identity.links.find(
      (item) => item.companyToken === companyToken && item.companyPlayerId === companyPlayerId,
    );
    if (!link?.claimId || !link.claimKey || !this.gateway.identityClaimStatus) return identity;
    const claim = await this.gateway.identityClaimStatus(companyToken, link.claimId, link.claimKey);
    const next = replaceLink(identity, {
      ...link,
      verification: claim.status,
      updatedAt: claim.resolvedAt ?? this.now(),
    });
    await this.repository.saveIdentity(next);
    return next;
  }
  async resolve(
    companyToken: string,
    claim: IdentityClaim,
    ownerKey: string,
    action: 'approve' | 'reject' | 'revoke',
  ): Promise<IdentityClaim> {
    if (!this.gateway.resolveIdentityClaim) throw new Error('Эта версия сервера не поддерживает связи профилей.');
    return this.gateway.resolveIdentityClaim(companyToken, claim.id, ownerKey, action);
  }
}
