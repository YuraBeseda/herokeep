import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import {
  applyHp,
  confirmRecoveryCodesAndContinue,
  hpValueLocator,
  loginAndContinue,
  openCharacterByName,
  registerToCodesStep,
  syncBadgeForName,
  uniqueUsername,
} from './helpers';

/** task-11-brief.md scenarios (c) and (d): a live, no-reload push between two open browser
 * contexts over the real WebSocket (through `serve-with-proxy.mjs`'s upgrade tunnel), and the
 * Devices list + revoke-then-401 flow. See `auth.spec.ts`'s module doc for why every scenario
 * here reloads context A once, right after creating its character, before either context is
 * treated as "synced" — the same real reconciliation trigger, not a workaround. */

test.describe('sync: live updates and device revocation', () => {
  test('a damage applied in one context appears in a second, already-open context without reload', async ({
    page,
    browser,
  }) => {
    const username = uniqueUsername('live');
    const characterName = 'Aldric Sync Live';

    await test.step('context A: register, create the fighter, reload to start a live session', async () => {
      await registerToCodesStep(page, username, 'Context A');
      await confirmRecoveryCodesAndContinue(page);
      await createFighter(page, characterName);
      await page.reload();
      await page.goto('/characters');
      await expect(syncBadgeForName(page, characterName)).toHaveAttribute(
        'data-sync-state',
        'synced',
        { timeout: 45_000 },
      );
      await openCharacterByName(page, characterName);
      await expect(hpValueLocator(page, 'Current')).toHaveText('12');
    });

    const contextB = await browser.newContext();
    try {
      const pageB = await contextB.newPage();
      await test.step('context B: log in and open the SAME character', async () => {
        await loginAndContinue(pageB, username, 'Context B');
        await openCharacterByName(pageB, characterName);
        await expect(hpValueLocator(pageB, 'Current')).toHaveText('12');
      });

      await test.step('damage applied in A appears in B live, with no reload in B', async () => {
        await applyHp(page, 5, 'Damage');
        await expect(hpValueLocator(page, 'Current')).toHaveText('7');

        // No `pageB.reload()`/`pageB.goto()` anywhere in this step — only the live WS push
        // (`StreamSyncSession` -> `applyServerCommit` -> the store's own signals) can make this
        // assertion pass.
        await expect(hpValueLocator(pageB, 'Current')).toHaveText('7', { timeout: 15_000 });
      });
    } finally {
      await contextB.close();
    }
  });

  test('devices: settings shows both sessions; revoking one logs that device out on its next interaction', async ({
    page,
    browser,
  }) => {
    const username = uniqueUsername('dev');

    await test.step('context A: register (its own device session)', async () => {
      await registerToCodesStep(page, username, 'Context A Device');
      await confirmRecoveryCodesAndContinue(page);
    });

    const contextB = await browser.newContext();
    try {
      const pageB = await contextB.newPage();
      await test.step('context B: log in as the same user (a second device session)', async () => {
        await loginAndContinue(pageB, username, 'Context B Device');
      });

      const rowB = page.locator('.settings__devices-row', { hasText: 'Context B Device' });

      await test.step('settings (context A) lists both device sessions', async () => {
        await page.goto('/settings');
        await expect(page.locator('.settings__devices-row')).toHaveCount(2, { timeout: 15_000 });
        await expect(rowB).toBeVisible();
        // The viewing device's own row (A) never offers a revoke button (canRevoke: !current).
        const rowA = page.locator('.settings__devices-row', { hasText: 'Context A Device' });
        await expect(rowA.locator('.settings__devices-revoke')).toHaveCount(0);
      });

      await test.step('revoking device B from device A', async () => {
        await rowB.locator('.settings__devices-revoke').click();
        await expect(page.locator('.settings-revoke-device-confirm__title')).toBeVisible();
        await page.locator('.settings-revoke-device-confirm__confirm').click();
        await expect(rowB).toHaveCount(0);
        await expect(page.locator('.settings__devices-row')).toHaveCount(1);
      });

      await test.step('device B is logged out on its next interaction (a reload lands it anon)', async () => {
        await pageB.reload();
        await expect(pageB.locator('.app-shell__login-link')).toBeVisible({ timeout: 15_000 });
      });
    } finally {
      await contextB.close();
    }
  });
});
