import { expect, test } from '@playwright/test';

// The `srd-5e-2024-ru-sample` demo pack's `<id>@<version>` key — mirrors `packKey()` in
// settings.component.ts, which stamps it onto the imported pack chip's `data-pack-key` attribute.
const RU_DEMO_PACK_KEY = 'srd-5e-2024-ru-sample@0.1.0';

test.describe('library', () => {
  // One continuous golden path (task-15-brief.md's acceptance criteria for `library.spec.ts`):
  // browse, search, and open a detail in English; then switch the UI to Russian, import the
  // demo translation pack, search in Russian, and check the browse list's Cyrillic collation.
  // A single test — not several sharing a `beforeEach` — because each step's app state (the
  // imported pack, the active locale) is exactly the precondition the next step needs; splitting
  // it up would just mean re-doing the same setup steps per test.
  test('browse, search, and open a detail; switch to Russian, import the demo pack, search in Russian, and sort classes with Cyrillic collation', async ({
    page,
  }) => {
    await test.step('open /library — the "All" chip is selected and shows rows', async () => {
      await page.goto('/library');
      await expect(page.getByRole('button', { name: /^All/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.locator('.library-browse__row').first()).toBeVisible();
    });

    await test.step('search "fire" — Fireball ranks first, ahead of Fire Bolt and the other Fire spells', async () => {
      await page.getByRole('searchbox').fill('fire');
      await expect(page.locator('.library-browse__row-name').first()).toHaveText('Fireball');
    });

    await test.step('search "fireball" — the first result is Fireball', async () => {
      await page.getByRole('searchbox').fill('fireball');
      // The text reaches the URL after the field's debounce; wait for it so the click below
      // cannot be overtaken by that pending navigation.
      await expect(page).toHaveURL(/q=fireball/);
      await expect(page.locator('.library-browse__row-name').first()).toHaveText('Fireball');
    });

    await test.step('open the detail — the description includes "8d6"', async () => {
      await page.locator('.library-browse__row').first().click();
      await expect(page).toHaveURL(/\/library\//);
      await expect(page.locator('.library-detail__name')).toHaveText('Fireball');
      await expect(page.locator('.library-detail__description-body')).toContainText('8d6');
    });

    await test.step('switch the UI language to Russian in Settings', async () => {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.locator('.settings__language select').selectOption('ru');
      // Live switch, no reload (locale.spec.ts covers that in depth) — the title re-renders
      // in place; waiting for it also doubles as this step's "the switch took effect" check.
      await expect(page.locator('.settings__title')).toHaveText('Настройки');
    });

    await test.step('import the Russian demo pack', async () => {
      await page.locator('.settings__import-button').click();
      await expect(page.locator(`[data-pack-key="${RU_DEMO_PACK_KEY}"]`)).toBeVisible();
    });

    await test.step('search "огненный" — the first result is Огненный шар', async () => {
      await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
      await page.getByRole('searchbox').fill('огненный');
      await expect(page.locator('.library-browse__row-name').first()).toHaveText('Огненный шар');
    });

    await test.step('class list sorts with Cyrillic collation: Бард < Варвар < Воин', async () => {
      await page.locator('.hk-search__clear').click();
      await page.getByRole('button', { name: /^Классы/ }).click();
      const names = page.locator('.library-browse__row-name');
      await expect(names.nth(0)).toHaveText('Бард');
      await expect(names.nth(1)).toHaveText('Варвар');
      await expect(names.nth(2)).toHaveText('Воин');
    });
  });

  // The chip, search text and sort live in the URL, so both the in-app Back and the browser Back
  // return to the same list state (plan 19 task 2).
  test('the chip and search survive opening an entry and going back', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('button', { name: /^Items/ }).click();
    await page.getByRole('searchbox').fill('fireball');
    await expect(page).toHaveURL(/type=item.*q=fireball|q=fireball.*type=item/);
    await page.locator('.library-browse__row').first().click();
    await expect(page.locator('.library-detail__name')).toBeVisible();

    await page.locator('.library-detail__back').click();
    await expect(page.getByRole('button', { name: /^Items/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('searchbox')).toHaveValue('fireball');

    await page.locator('.library-browse__row').first().click();
    await expect(page.locator('.library-detail__name')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: /^Items/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('searchbox')).toHaveValue('fireball');

    // R74: the in-app Back also returns to where the page was scrolled to.
    await page.locator('.hk-search__clear').click();
    await expect(page).not.toHaveURL(/q=/);
    const rows = page.locator('.library-browse__row');
    await expect(rows.first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 900));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(20);
    // A DOM click, so Playwright does not scroll the page before it.
    await rows.first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.library-detail__name')).toBeVisible();
    await page.locator('.library-detail__back').click();
    await expect(rows.first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 50);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(50);
  });
});
