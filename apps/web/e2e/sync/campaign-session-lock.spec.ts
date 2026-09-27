import { expect, test } from '@playwright/test';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  endSession,
  gotoLog,
  gotoSettings,
  joinCampaign,
  linkCharacterByName,
  readJoinCode,
  registerAndSyncFighter,
  setEditOutsideSession,
  startSession,
} from './campaign-helpers';

/**
 * Plan-10 task-16-brief.md's T14 carry — a real session start/end round trip through the server,
 * plus the cross-device edit lock (ruling 7): once the DM sets `houseRules.editOutsideSession`
 * to `'locked'`, a member's ALREADY-OPEN sheet (no navigation, no reload) must notice within
 * `CampaignEditLockService`'s own bounded poll (`CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS`, 15s in
 * production — no DI override reachable from a production e2e build, so this test tolerates the
 * full poll window rather than trying to shorten it) once a `session.started`/`session.ended`
 * lands on the DM's own device and propagates through this device's always-on background
 * campaign `StreamSyncSession` (T5 ruling — every campaign in this account's index gets one).
 */
test.describe('campaign: session round trip and cross-device edit lock', () => {
  test("locking edits outside a session locks the member's open sheet; starting a session unlocks it within the poll bound", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    const campaignName = 'Session Lock Campaign';
    const characterName = 'Aldric Session Lock';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and create the campaign', async () => {
      const dmUsername = uniqueUsername('dmlock');
      await registerToCodesStep(page, dmUsername, 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, campaignName);
      joinCode = await readJoinCode(page);
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      let characterId = '';

      await test.step('member: register, create + sync a fighter, join, link', async () => {
        const result = await registerAndSyncFighter(
          memberPage,
          'memlock',
          'Member Device',
          characterName,
        );
        characterId = result.characterId;
        const joinedCampaignId = await joinCampaign(memberPage, joinCode, 'Locked Player');
        expect(joinedCampaignId).toBe(campaignId);
        await linkCharacterByName(memberPage, characterName);
      });

      await test.step('DM: sets "editing outside a session" to Locked', async () => {
        await gotoSettings(page, campaignId);
        await setEditOutsideSession(page, 'locked');
      });

      const banner = memberPage.locator('.campaign-edit-lock-banner');

      await test.step("the member's sheet (opened AFTER the lock) shows the edit-lock banner", async () => {
        await memberPage.goto(`/c/${characterId}/play`);
        await expect(banner).toBeVisible({ timeout: 30_000 });
      });

      await test.step('DM: starts a live session', async () => {
        await gotoLog(page, campaignId);
        await startSession(page, 'Table Night');
        // `.log-tab__divider`'s own rendering order is seq-ascending (oldest first) — `.first()`
        // is "Session started" here (the only divider that exists yet).
        await expect(page.locator('.log-tab__divider').first()).toContainText('Session started', {
          timeout: 15_000,
        });
      });

      await test.step("the member's already-open, never-reloaded sheet unlocks within the poll bound", async () => {
        // No `memberPage.reload()`/`goto()` anywhere in this step — only
        // `CampaignEditLockService`'s own bounded poll (re-reading `camp:<id>`'s local events)
        // can make this pass.
        await expect(banner).toBeHidden({ timeout: 25_000 });
      });

      await test.step('DM: ends the session, completing the round trip', async () => {
        await gotoLog(page, campaignId);
        await endSession(page);
        // `.last()` — the newest divider, now that both start and end exist.
        await expect(page.locator('.log-tab__divider').last()).toContainText('Session ended', {
          timeout: 15_000,
        });
      });

      await test.step("the member's sheet re-locks, again within the poll bound and no reload", async () => {
        await expect(banner).toBeVisible({ timeout: 25_000 });
      });
    } finally {
      await memberContext.close();
    }
  });
});
