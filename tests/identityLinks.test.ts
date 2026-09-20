import { describe, expect, it } from 'vitest';
import { IdentityLinks } from '../src/application/IdentityLinks';
import type { CompanyGateway } from '../src/application/ports/companyGateway';
import type { IdentityRepository } from '../src/application/ports/repositories';
import type { PersonIdentity } from '../src/domain/identities/PersonIdentity';

describe('IdentityLinks', () => {
  it('keeps immutable profiles separate while a claim moves from pending to approved', async () => {
    let saved: PersonIdentity | undefined;
    const repository: IdentityRepository = {
      listIdentities: async () => [],
      saveIdentity: async (value) => {
        saved = value;
      },
      ownerKey: async () => undefined,
      saveOwnerKey: async () => undefined,
    };
    const gateway = {
      createIdentityClaim: async () => ({
        claim: {
          id: 'claim',
          companyPlayerId: 'company-player',
          displayName: 'Михаил',
          createdAt: '2026-09-20',
          status: 'pending' as const,
        },
        claimKey: 'capability',
      }),
      identityClaimStatus: async () => ({
        id: 'claim',
        companyPlayerId: 'company-player',
        displayName: 'Михаил',
        createdAt: '2026-09-20',
        status: 'approved' as const,
      }),
    } as unknown as CompanyGateway;
    const links = new IdentityLinks(
      repository,
      gateway,
      () => 'identity',
      () => '2026-09-20',
    );
    const pending = await links.claim('company', 'company-player', 'local-player', 'Михаил');
    expect(pending.primaryLocalPlayerId).toBe('local-player');
    expect(pending.links[0]).toMatchObject({ companyPlayerId: 'company-player', verification: 'pending' });
    const approved = await links.refresh(pending, 'company', 'company-player');
    expect(approved.links[0]?.verification).toBe('approved');
    expect(saved?.links[0]?.claimKey).toBe('capability');
  });
});
