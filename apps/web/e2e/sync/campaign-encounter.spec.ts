import { expect, test } from '@playwright/test';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  gotoParty,
  joinCampaign,
  linkCharacterByName,
  readJoinCode,
  registerAndSyncFighter,
} from './campaign-helpers';

/**
 * Plan 18 task 2: the DM runs an encounter from the party tab; a member's linked hero takes a
 * 3-round condition inside it, the DM's round advance lands live on the member's open sheet
 * (the chip counts down 3 -> 2), and ending the encounter flips the chip to its ended state.
 */
test.describe('campaign: encounter round counter', () => {
  test('DM starts, advances and ends an encounter; the member condition chip follows', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);

    const characterName = 'Aldric Encounter';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and create the campaign', async () => {
      await registerToCodesStep(page, uniqueUsername('dmenc'), 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, 'Encounter Campaign');
      joinCode = await readJoinCode(page);
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      let characterId = '';

      await test.step('member: sync a fighter, join, link it', async () => {
        ({ characterId } = await registerAndSyncFighter(
          memberPage,
          'membenc',
          'Member Device',
          characterName,
        ));
        await joinCampaign(memberPage, joinCode, 'Member Enc');
        await linkCharacterByName(memberPage, characterName);
      });

      const plate = page.locator('.encounter-plate');
      await test.step('DM starts an encounter', async () => {
        await gotoParty(page, campaignId);
        await plate.getByRole('button', { name: 'Start encounter', exact: true }).click();
        await expect(plate.locator('.encounter-plate__reading')).toContainText('Round 1', {
          timeout: 15_000,
        });
      });

      const chip = memberPage.locator('hk-condition-chip');
      await test.step('member adds a 3-round condition on the open sheet', async () => {
        // The member device only pulls the campaign stream while inside the campaign UI, so let the
        // encounter land locally there before opening the sheet (which reads it from local storage).
        await gotoParty(memberPage, campaignId);
        await expect(memberPage.locator('.encounter-plate__reading')).toContainText('Round 1', {
          timeout: 25_000,
        });
        await memberPage.goto(`/c/${characterId}/play`);
        await expect(memberPage.locator('.conditions__round [role="status"]')).toContainText(
          'Round 1',
          { timeout: 25_000 },
        );
        await memberPage.locator('.conditions__add').click();
        await memberPage.locator('.condition-dialog__chip', { hasText: 'Blinded' }).click();
        await memberPage.locator('.condition-dialog__rounds .hk-numfield__in').fill('3');
        await memberPage.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(chip).toContainText('3 rounds');
      });

      await test.step('DM advances a round; the chip reads 2 rounds with no reload', async () => {
        await plate.getByRole('button', { name: 'Advance round', exact: true }).click();
        await expect(plate.locator('.encounter-plate__reading')).toContainText('Round 2', {
          timeout: 15_000,
        });
        await expect(chip).toContainText('2 rounds', { timeout: 20_000 });
      });

      await test.step('DM ends the encounter; the chip shows the ended state', async () => {
        await plate.getByRole('button', { name: 'End encounter', exact: true }).click();
        await expect(plate.getByRole('button', { name: 'Start encounter', exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await expect(chip).toContainText('Ended', { timeout: 20_000 });
      });
    } finally {
      await memberContext.close();
    }
  });
});
