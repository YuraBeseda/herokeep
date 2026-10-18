import path from 'node:path';
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

const SAMPLE_HKPACK = path.join(__dirname, '..', 'fixtures', 'packs', 'sample-content.hkpack');

/**
 * task-11-brief.md scenarios (a) and (b): real registration against the Node API adapter behind
 * `serve-with-proxy.mjs`, the ADR-012 recovery-codes step, and cross-device visibility of a
 * character created after login.
 *
 * Final fix wave, Important finding 2: `SyncService`'s reconciliation used to run ONLY when
 * `AuthService.status`/`LeaderService.isLeader` CHANGE value (`sync.service.ts`'s constructor
 * `effect()`) — it never watched for a brand-new local character created mid-session, so a
 * character created while ALREADY authed+leader (this flow's own order: register -> create) sat
 * as an ordinary local-committed stream, exactly like solo/offline mode, until some LATER
 * auth/leader transition (a login, a reload) happened to re-run reconciliation. `CharacterStore`
 * now fires `onCreate` for every `create()`, which `SyncService` subscribes to directly — scenario
 * (a) below asserts the new character reaches the server with NO `page.reload()` (and no other
 * auth/leader transition) anywhere in between, proving that hook rather than relying on a reload
 * to paper over it.
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

    await test.step('the new character uploads to the server on its own — no reload needed', async () => {
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

    await test.step('device A: register, create the fighter, pin a content pack, reload to upload it', async () => {
      await registerToCodesStep(page, username, 'Device A');
      await confirmRecoveryCodesAndContinue(page);
      const characterId = await createFighter(page, characterName);
      // Plan 15 task 9: pins are events and sync; installed packs are device-local and do not.
      // Device A installs the checked-in sample pack and pins it on the Build tab.
      await page.goto('/packs');
      await page.locator('.packs-list__import-input').setInputFiles(SAMPLE_HKPACK);
      await page.locator('.pack-trust-dialog__install').click();
      await expect(page.locator('.pack-trust-dialog')).toHaveCount(0);
      await page.goto(`/c/${characterId}/build`);
      const pin = page.locator(
        '.build-packs__row[data-pack-id="sample-content"] .build-packs__toggle',
      );
      await pin.click();
      await expect(pin).toBeChecked();
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
        // The pin synced, the pack did not: device B never installed sample-content.
        await expect(pageB.locator('.sheet-shell__missing-packs')).toContainText(
          'sample-content@1.0.0',
        );
      } finally {
        await contextB.close();
      }
    });
  });
});
