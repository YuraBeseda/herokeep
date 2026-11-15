import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import { openPhoneTab } from '../helpers/viewport';

test.describe('phone sheet (390 x 844)', () => {
  test.beforeEach(async ({ page }) => {
    await createFighter(page, 'Aldric Phone');
  });

  test('Combat tab shows HP, AC, speed, saves and attacks above the fold', async ({ page }) => {
    await expect(page).toHaveURL(/\/c\/[^/]+\/combat$/);
    const height = page.viewportSize()!.height;
    const parts = {
      hp: page.locator('.hk-hp-gauge__current'),
      ac: page.locator('hk-shield-badge'),
      speed: page.locator('.vitals__speed').first(),
      saves: page.locator('app-abilities-leaf'),
      attacks: page.locator('app-attacks-leaf'),
    };
    for (const [name, part] of Object.entries(parts)) {
      await expect(part, name).toBeVisible();
      const box = (await part.boundingBox())!;
      expect(box.y, `${name} starts above the fold`).toBeLessThan(height);
    }
    // The attacks' first row starts on screen (the pinned strap covers its lower edge; it scrolls).
    const firstAttack = (await page.locator('hk-attack-row').first().boundingBox())!;
    expect(firstAttack.y, 'first attack row').toBeLessThan(height);
    // Saves are complete above the strap: a save seal and its roll button for each of the six.
    const saves = (await parts.saves.boundingBox())!;
    expect(saves.y + saves.height, 'saves end above the fold').toBeLessThanOrEqual(height);
  });

  test('bottom tabs switch Combat, Spells, Bag, Hero and More', async ({ page }) => {
    for (const tab of ['Spells', 'Bag', 'Hero', 'More', 'Combat'] as const) {
      await openPhoneTab(page, tab);
    }
  });

  test('long-press on an icon button shows its hint', async ({ page }) => {
    // The top bar's Edit button is the one icon button on the phone Combat screen.
    const button = page.locator('button[hk-icon-button]').first();
    await expect(button).toBeVisible();
    const label = (await button.getAttribute('aria-label'))!;
    const box = (await button.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(page.getByRole('tooltip').filter({ hasText: label })).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});
