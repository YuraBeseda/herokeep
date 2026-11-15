import { expect, test } from '@playwright/test';
import { createFighter } from '../helpers/create-fighter';

// R42, in a real browser: on a 390 px phone in Ukrainian (real strings, no fit locale) a strap tile
// whose label does not fit drops to its icon, keeps its accessible name, and the hint is the tile's own.
test('the phone strap drops overlong labels to icons and keeps their names', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 600, 'phone layout only');
  const phone = { width: 390, height: 844 };
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await createFighter(page, 'Aldric Strap');
  await page.setViewportSize(phone);
  await page.evaluate(() => localStorage.setItem('hk.locale', 'uk'));
  await page.goto(`/c/${id}/combat`);

  const tiles = page.locator('.hk-astrap__zone--primary .hk-act');
  await expect(tiles.first()).toBeVisible();
  const iconOnly = page.locator('.hk-astrap__zone--primary .hk-act.hk-fit-label--icon-only');
  await expect(iconOnly.first()).toBeVisible();
  // One snapshot, so a tile re-fitting mid-loop cannot leave a stale locator behind.
  const names = await iconOnly.evaluateAll((els) =>
    els.map((el) => {
      const label = el.querySelector('[data-fit-label]') as HTMLElement;
      return { text: (label.textContent ?? '').trim(), width: label.getBoundingClientRect().width };
    }),
  );
  expect(names.length).toBeGreaterThan(0);
  for (const { text, width } of names) {
    expect(text).not.toBe('');
    // Visually gone (1 px), but still the tile's accessible name.
    expect(width).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: text }).first()).toBeVisible();
  }
});
