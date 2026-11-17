import { expect, test } from '@playwright/test';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  gotoParty,
  gotoSettings,
  joinCampaign,
  linkCharacterByName,
  readJoinCode,
  registerAndSyncFighter,
} from './campaign-helpers';

/**
 * Plan 18 task 3: the DM turns "Players add items themselves" off in the campaign settings and the
 * member's open sheet locks Add from library live, with the reason described (no inline caption).
 */
test.describe('campaign: house rules', () => {
  test('DM turns off players adding items; the member Add item locks live', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);

    const characterName = 'Aldric Rules';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and create the campaign', async () => {
      await registerToCodesStep(page, uniqueUsername('dmrules'), 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, 'Rules Campaign');
      joinCode = await readJoinCode(page);
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      let characterId = '';

      await test.step('member: sync a fighter, join, link it', async () => {
        ({ characterId } = await registerAndSyncFighter(
          memberPage,
          'membrules',
          'Member Device',
          characterName,
        ));
        await joinCampaign(memberPage, joinCode, 'Member Rules');
        await linkCharacterByName(memberPage, characterName);
      });

      const addItem = memberPage.getByRole('button', { name: 'Add from library', exact: true });
      await test.step('member: Add from library is open on the linked sheet', async () => {
        // The member device pulls the campaign stream from inside the campaign UI (as in the
        // encounter spec), so pass through the party tab first to start the live session.
        await gotoParty(memberPage, campaignId);
        await memberPage.goto(`/c/${characterId}/play`);
        await expect(addItem).toBeVisible({ timeout: 25_000 });
        await expect(addItem).not.toHaveAttribute('aria-disabled', 'true');
      });

      await test.step('DM turns "Players add items themselves" off and saves', async () => {
        await gotoSettings(page, campaignId);
        const toggle = page.getByRole('switch', { name: /Players add items themselves/ });
        await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
        await toggle.click();
        await page.locator('.campaign-settings__save').click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
      });

      await test.step('member: Add from library locks with the reason, no reload', async () => {
        await expect(addItem).toHaveAttribute('aria-disabled', 'true', { timeout: 45_000 });
        await expect(addItem).toHaveAccessibleDescription(
          'Only your DM adds items in Rules Campaign',
        );
        await addItem.click({ force: true });
        await expect(memberPage.locator('.add-item-dialog__title')).toHaveCount(0);
      });
    } finally {
      await memberContext.close();
    }
  });
});
