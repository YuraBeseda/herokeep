import { expect, test, type Page } from '@playwright/test';

// Matches an un-interpolated Transloco key shape (e.g. `settings.packs.import-demo`) — the
// telltale sign of a missing translation falling through to the raw key instead of text. Two
// dots (three lowercase segments) are required, which is deliberately narrow enough to not also
// catch the about screen's real prose (`https://www.dndbeyond.com/srd` *would* match this shape —
// three real lowercase dot-separated segments — which is exactly why that screen is not one of
// the four checked here; see the module doc below).
const KEY_SHAPE_RE = /[a-z]+\.[a-z]+\.[a-z-]+/;

/** Asserts none of the page's currently visible text looks like a raw, un-interpolated i18n key. */
async function assertNoRawKeys(page: Page, screen: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, `${screen}: visible text looks like a raw i18n key`).not.toMatch(KEY_SHAPE_RE);
}

test.describe('locale', () => {
  // Home, Library, a library Detail, and Settings — task-15-brief.md's "four screens". The about
  // screen is deliberately excluded: its legal attribution text contains real URLs
  // (`https://www.dndbeyond.com/srd`) that match the same three-segment lowercase-dot shape as a
  // raw i18n key, which would make this check flag genuine content rather than a bug — a11y.spec.ts
  // already covers the about screen for what it's meant to check (accessibility, not text shape).
  test('switching the UI language never triggers a navigation, and no raw i18n key leaks into visible text on any of the four screens', async ({
    page,
  }) => {
    let loadCount = 0;
    page.on('load', () => {
      loadCount++;
    });

    await test.step('English: home, library, a detail, settings', async () => {
      await page.goto('/');
      await assertNoRawKeys(page, 'home (en)');

      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await assertNoRawKeys(page, 'library (en)');

      await page.locator('.library-browse__row').first().click();
      await expect(page.locator('.library-detail__name')).toBeVisible();
      await assertNoRawKeys(page, 'library detail (en)');

      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await assertNoRawKeys(page, 'settings (en)');
    });

    await test.step('switch to Russian from Settings — a live switch, not a navigation', async () => {
      await page.locator('.settings__language-chip[data-locale="ru"]').click();
      await expect(page.locator('.settings__title')).toHaveText('Настройки');
      await assertNoRawKeys(page, 'settings (ru)');
    });

    await test.step('Russian: home, library, a detail', async () => {
      await page.getByRole('link', { name: 'Главная', exact: true }).click();
      await assertNoRawKeys(page, 'home (ru)');

      await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
      await assertNoRawKeys(page, 'library (ru)');

      await page.locator('.library-browse__row').first().click();
      await expect(page.locator('.library-detail__name')).toBeVisible();
      await assertNoRawKeys(page, 'library detail (ru)');
    });

    // The whole traversal above — two languages across four screens, one language switch — is
    // all client-side (Angular Router navigations + a live Transloco lang switch); only the very
    // first `page.goto('/')` should ever have fired the browser's `load` event.
    expect(loadCount).toBe(1);
  });
});
