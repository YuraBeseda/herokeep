import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';
import { clickStrapAction } from '../helpers/sheet';
import { openPhoneTab } from '../helpers/viewport';

test.describe('phone sheet (390 x 844)', () => {
  test.beforeEach(async ({ page }) => {
    await createFighter(page, 'Aldric Phone');
  });

  // R71: the fold holds in every shipped language, with room to spare, not by a pixel.
  const HEADROOM = 8;
  for (const locale of ['en', 'uk'] as const) {
    test(`Combat tab fits above the strap in ${locale}`, async ({ page }) => {
      if (locale !== 'en') {
        await page.evaluate((l) => localStorage.setItem('hk.locale', l), locale);
        await page.reload();
      }
      await expect(page).toHaveURL(/\/c\/[^/]+\/combat$/);
      await expect(page.locator('hk-attack-row').first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}`));
      // Measure from the top: the sheet can open scrolled, which would hide an overflow.
      await page.evaluate(() => window.scrollTo(0, 0));
      // The visible area is the viewport minus the pinned action strap (ruling R69).
      const strap = (await page.locator('.hk-astrap').boundingBox())!;
      const parts = {
        hp: page.locator('.hk-hp-gauge__current'),
        ac: page.locator('hk-shield-badge'),
        speed: page.locator('.vitals__speed').first(),
        saves: page.locator('app-abilities-leaf'),
        firstAttack: page.locator('hk-attack-row').first(),
        // R72: the Roll-damage control is part of the row and must clear the strap too.
        firstAttackRoll: page.locator('hk-attack-row').first().locator('button'),
        // The HP actions stay on one row: the last button starts at the first one's top.
        hpActions: page.locator('.hk-hp-gauge__controls'),
      };
      for (const [name, part] of Object.entries(parts)) {
        await expect(part, name).toBeVisible();
        const box = (await part.boundingBox())!;
        expect(box.y + box.height, `${name} ends above the strap`).toBeLessThanOrEqual(
          strap.y - HEADROOM,
        );
      }
      const hpButtons = page.locator('.hk-hp-gauge__controls button');
      expect(await hpButtons.count()).toBe(3);
      const tops = await hpButtons.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
      expect(new Set(tops).size, `HP buttons share one row (tops ${tops})`).toBe(1);
      const seals = page.locator('.abilities--saves .abilities__seal');
      expect(await seals.count()).toBe(6);
      for (let i = 0; i < 6; i++) {
        const box = (await seals.nth(i).boundingBox())!;
        expect(box.width, `save seal ${i} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `save seal ${i} height`).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('bottom tabs switch Combat, Spells, Bag, Hero and More', async ({ page }) => {
    for (const tab of ['Spells', 'Bag', 'Hero', 'More', 'Combat'] as const) {
      await openPhoneTab(page, tab);
    }
  });

  test('the rest dialog is a bottom sheet with a grip', async ({ page }) => {
    await clickStrapAction(page, 'short-rest');
    const dialog = page.locator('.hk-dialog--sheet');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.hk-dialog__grip')).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const { width, height } = page.viewportSize()!;
    expect(box.width, 'full width').toBeGreaterThanOrEqual(width - 1);
    expect(box.y + box.height, 'docked to the bottom').toBeGreaterThanOrEqual(height - 1);
  });

  test('long-press on an icon button shows its hint', async ({ page }) => {
    // The top bar's Edit button is the one icon button on the phone Combat screen.
    const button = page.locator('button[hk-icon-button]').first();
    await expect(button).toBeVisible();
    // The sheet can open scrolled (the wizard's last click was far down the page); a touch outside
    // the viewport never reaches the button, so bring it into view before aiming at it.
    await button.scrollIntoViewIfNeeded();
    const label = (await button.getAttribute('aria-label'))!;
    const box = (await button.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(page.getByRole('tooltip').filter({ hasText: label })).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});
