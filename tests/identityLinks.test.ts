import { describe, expect, it } from 'vitest';
import { IdentityLinks } from '../src/application/IdentityLinks';

describe('IdentityLinks', () => {
  it('keeps immutable profiles separate while a claim moves from pending to approved', async () => {
    let saved: any;
    const repository = {
      listIdentities: async () => [],
      saveIdentity: async (value: any) => {
        saved = value;
      },
      ownerKey: async () => undefined,
      saveOwnerKey: async () => undefined,
    };
    const gateway: any = {
      createIdentityClaim: async () => ({
        claim: {
          id: 'claim',
          companyPlayerId: 'company-player',
          displayName: 'Михаил',
          createdAt: '2026-09-20',
          status: 'pending',
        },
        claimKey: 'capability',
      }),
      identityClaimStatus: async () => ({
        id: 'claim',
        companyPlayerId: 'company-player',
        displayName: 'Михаил',
        createdAt: '2026-09-20',
        status: 'approved',
      }),
    };
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
    expect(saved.links[0]?.claimKey).toBe('capability');
  });
});
