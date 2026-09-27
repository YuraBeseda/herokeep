import { expect, test, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  assignStandardArray,
  equipGear,
  nameCharacter,
  pickBackground,
  pickClass,
  pickFightingStyleAndWeaponMasteries,
  pickSkills,
  pickSpecies,
} from '../helpers/create-fighter';
import {
  confirmRecoveryCodesAndContinue,
  registerToCodesStep,
  uniqueUsername,
  waitForCharacterInList,
} from './helpers';
import {
  addPregen,
  claimPregenByName,
  confirmHandoverTo,
  createCampaign,
  gotoParty,
  joinCampaign,
  linkCharacterByName,
  openHandoverDialog,
  readJoinCode,
  resumeLinkCharacterByName,
  skipLinking,
} from './campaign-helpers';

/** The fighter-1 wizard walk (task-15-brief.md's binding build), started from WHEREVER the page
 * already is (`'current'` — see `openCreateWizard`'s own doc) rather than a fresh
 * `page.goto('/characters/new')`, which would drop the DM's own `?returnUrl=` query param. Ends
 * on `/g/<id>/link-character` (`CreateWizardComponent.navigateAfterCreate`'s `returnUrl` branch)
 * instead of `finishReviewAndCreate`'s own `/c/<id>/play` — the ONE reason this can't just call
 * `createFighter(page, name, 'current')` directly. */
async function createPregenAtCurrentLocation(page: Page, name: string): Promise<void> {
  await nameCharacter(page, name, 'current');
  await pickSpecies(page);
  await pickBackground(page);
  await applyBackgroundAbilities(page);
  await pickClass(page);
  await assignStandardArray(page);
  await pickSkills(page);
  await pickFightingStyleAndWeaponMasteries(page);
  await equipGear(page);

  await expect(page.locator('.create-wizard__incomplete')).toHaveCount(0);
  const createButton = page.locator('.create-wizard__create');
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/link-character$/, { timeout: 20_000 });
}

/**
 * Plan-10 task-16-brief.md's T12 carry — the FULL real-network claim path: the DM creates a
 * pregen (task-12-brief.md's own "structurally nothing but an ordinary DM-owned character joined
 * to their own campaign"), hands it over via the real 5-step sequence (ending in the real
 * `POST /api/characters/:id/transfer` — R-T12), and the receiving member discovers it (their own
 * `GET /api/characters` now genuinely lists it), pulls it onto their device
 * (`SyncService.pullClaimedCharacter`, reusing the ordinary new-device restore routine), and
 * finishes linking it to the campaign (`retryCampaignLinkStepB`'s idempotent resend). This
 * exercises the transfer route + restore + join end-to-end — no fakes.
 */
test.describe('campaign: pregen handover and real claim', () => {
  test('DM creates a pregen, hands it to a member, the member discovers/pulls/re-links it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);

    const campaignName = 'Claim Campaign';
    const pregenName = 'Pregen Paladin';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register, create the campaign, create a pregen via "Add pregen"', async () => {
      const dmUsername = uniqueUsername('dmclaim');
      await registerToCodesStep(page, dmUsername, 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, campaignName);
      joinCode = await readJoinCode(page);

      await gotoParty(page, campaignId);
      await addPregen(page);
      await createPregenAtCurrentLocation(page, pregenName);
    });

    await test.step('DM: self-joins the pregen (a DM-owned character joining its own campaign)', async () => {
      await linkCharacterByName(page, pregenName);
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();

      await test.step('member: registers and joins by code as a bystander (no character of their own)', async () => {
        const memberUsername = uniqueUsername('memclaim');
        await registerToCodesStep(memberPage, memberUsername, 'Member Device');
        await confirmRecoveryCodesAndContinue(memberPage);
        const joinedCampaignId = await joinCampaign(memberPage, joinCode, 'Claimant');
        expect(joinedCampaignId).toBe(campaignId);
        await skipLinking(memberPage);
      });

      await test.step('DM: hands the pregen over to the member (real transfer route)', async () => {
        await gotoParty(page, campaignId);
        await openHandoverDialog(page, pregenName);
        await confirmHandoverTo(page, 'Claimant');
        // The DM's own already-open party tab reflects the roster's new ownerId reactively (the
        // handover sequence's own local echo) — the pregen is no longer THEIRS to hand over again.
        const card = page.locator('.party-tab__card', { hasText: pregenName });
        await expect(card.locator('.party-tab__handover')).toHaveCount(0, { timeout: 15_000 });
      });

      await test.step('member: discovers, pulls, and finishes linking the claimed pregen', async () => {
        await memberPage.goto(`/g/${campaignId}/link-character`);
        await claimPregenByName(memberPage, pregenName);
        await resumeLinkCharacterByName(memberPage, pregenName);
      });

      await test.step("the pregen is now a genuine local character on the member's device", async () => {
        await waitForCharacterInList(memberPage, pregenName);
      });
    } finally {
      await memberContext.close();
    }
  });
});
