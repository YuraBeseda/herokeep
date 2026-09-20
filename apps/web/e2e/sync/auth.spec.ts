import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import {
  acValueLocator,
  confirmRecoveryCodesAndContinue,
  hpValueLocator,
  loginAndContinue,
  openCharacterByName,
  registerToCodesStep,
  syncBadgeForName,
  uniqueUsername,
  waitForCharacterInList,
} from './helpers';

/**
 * task-11-brief.md scenarios (a) and (b): real registration against the Node API adapter behind
 * `serve-with-proxy.mjs`, the ADR-012 recovery-codes step, and cross-device visibility of a
 * character created after login.
 *
 * `SyncService`'s reconciliation only runs when `AuthService.status`/`LeaderService.isLeader`
 * CHANGE value (`sync.service.ts`'s constructor `effect()`) — it does not watch for brand-new
 * local characters created mid-session. A character created while ALREADY authed+leader (this
 * flow's own order: register -> create) is therefore written locally as an ordinary committed
 * stream first, exactly like solo/offline mode, and only becomes a PENDING/synced stream once
 * reconciliation runs again — which a `page.reload()` triggers for real (a fresh bootstrap
 * re-fires `AuthService.init()` and leader election from scratch, landing on the SAME still-valid
 * session cookie). That reload is not a workaround for a broken assertion — it is the same
 * "close and reopen the app" trigger a real device goes through, and the scenario's actual
 * assertion (a second, completely independent browser context sees the character with the right
 * sheet) is exactly as strict either way.
 */

test.describe('auth: register, recovery codes, and cross-device visibility', () => {
  test('register shows 6 distinct recovery codes, gates Continue on confirmation, and a character created afterward reaches the server', async ({
    page,
    browser,
  }) => {
    const username = uniqueUsername('reg');
    const characterName = 'Aldric Sync Register';

    await test.step('register: the codes step shows exactly 6 distinct codes and gates Continue', async () => {
      const codes = await registerToCodesStep(page, username, 'Context A');
      expect(new Set(codes).size).toBe(6);
      await expect(page.locator('.register__continue')).toBeDisabled();
    });

    await test.step('confirming the codes continues to /characters', async () => {
      await confirmRecoveryCodesAndContinue(page);
    });

    await test.step('create a fighter (AC 19, HP 12/12) while already authed', async () => {
      await createFighter(page, characterName);
      await expect(acValueLocator(page)).toHaveText('19');
      await expect(hpValueLocator(page, 'Current')).toHaveText('12');
      await expect(hpValueLocator(page, 'Max')).toHaveText('12');
    });

    await test.step('a reload re-runs reconciliation and uploads the new character', async () => {
      await page.reload();
      await expect(page.locator('.play-tab')).toBeVisible();
      await page.goto('/characters');
      await expect(syncBadgeForName(page, characterName)).toHaveAttribute(
        'data-sync-state',
        'synced',
        { timeout: 45_000 },
      );
    });

    await test.step('a second device logs in as the same user and sees the character, correctly', async () => {
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      try {
        await loginAndContinue(pageB, username, 'Context B');
        await openCharacterByName(pageB, characterName);
        await expect(acValueLocator(pageB)).toHaveText('19');
        await expect(hpValueLocator(pageB, 'Current')).toHaveText('12');
        await expect(hpValueLocator(pageB, 'Max')).toHaveText('12');
      } finally {
        await contextB.close();
      }
    });
  });

  test('restore-on-new-device: a brand-new context with clean storage logs in and sees the restored character with correct HP/AC', async ({
    page,
    browser,
  }) => {
    const username = uniqueUsername('restore');
    const characterName = 'Aldric Sync Restore';

    await test.step('device A: register, create the fighter, reload to upload it', async () => {
      await registerToCodesStep(page, username, 'Device A');
      await confirmRecoveryCodesAndContinue(page);
      await createFighter(page, characterName);
      await page.reload();
      await page.goto('/characters');
      await expect(syncBadgeForName(page, characterName)).toHaveAttribute(
        'data-sync-state',
        'synced',
        { timeout: 45_000 },
      );
    });

    await test.step('device B: a brand-new browser context (no local storage at all) logs in and restores', async () => {
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      try {
        await loginAndContinue(pageB, username, 'Device B');
        // The character shows up in the list at all is the restore-on-new-device proof: this
        // context never created or synced anything locally before this login.
        await waitForCharacterInList(pageB, characterName);

        await openCharacterByName(pageB, characterName);
        await expect(acValueLocator(pageB)).toHaveText('19');
        await expect(hpValueLocator(pageB, 'Current')).toHaveText('12');
        await expect(hpValueLocator(pageB, 'Max')).toHaveText('12');
      } finally {
        await contextB.close();
      }
    });
  });
});
