import { expect, test, type Page } from '@playwright/test';

// Matches an un-interpolated Transloco key shape (e.g. `settings.packs.import-demo`) — the
// telltale sign of a missing translation falling through to the raw key instead of text. Two
// dots (three lowercase segments) are required.
const KEY_SHAPE_RE = /[a-z]+\.[a-z]+\.[a-z-]+/;

// The about screen's legal attribution text legitimately contains URLs (e.g.
// `https://www.dndbeyond.com/srd`, in every locale — see `attribution.ts`/`about/*.json`) whose
// domain (`www.dndbeyond.com`: three real lowercase dot-separated segments) matches the very same
// shape as a raw i18n key. Stripping URL substrings before matching — rather than excluding the
// screen that happens to have one — is what lets this check cover "no visible key names
// anywhere" for real, including on about.
const URL_RE = /https?:\/\/\S+/gi;

type Locale = 'en' | 'ru' | 'uk';

interface NavLabels {
  readonly home: string;
  readonly library: string;
  readonly settings: string;
  readonly about: string;
}

const NAV: Record<Locale, NavLabels> = {
  en: { home: 'Home', library: 'Library', settings: 'Settings', about: 'About' },
  ru: { home: 'Главная', library: 'Библиотека', settings: 'Настройки', about: 'О приложении' },
  uk: { home: 'Головна', library: 'Бібліотека', settings: 'Налаштування', about: 'Про застосунок' },
};

/** Asserts none of the page's currently visible text looks like a raw, un-interpolated i18n key. */
async function assertNoRawKeys(page: Page, screen: string): Promise<void> {
  const text = (await page.locator('body').innerText()).replace(URL_RE, '');
  expect(text, `${screen}: visible text looks like a raw i18n key`).not.toMatch(KEY_SHAPE_RE);
}

/**
 * Visits all five screens (task-15-brief.md's a11y list: home/library/detail/settings/about — the
 * plan's binding criterion is "no visible key names *anywhere*") in the given locale, ending on
 * settings so the caller can switch language and continue. Assumes the app is already on some
 * screen in this locale (a live Transloco switch, not a navigation).
 */
async function visitFiveScreens(page: Page, locale: Locale): Promise<void> {
  const nav = NAV[locale];

  await page.getByRole('link', { name: nav.home, exact: true }).click();
  await assertNoRawKeys(page, `home (${locale})`);

  await page.getByRole('link', { name: nav.library, exact: true }).click();
  await assertNoRawKeys(page, `library (${locale})`);

  await page.locator('.library-browse__row').first().click();
  await expect(page.locator('.library-detail__name')).toBeVisible();
  await assertNoRawKeys(page, `library detail (${locale})`);

  await page.getByRole('link', { name: nav.about, exact: true }).click();
  await assertNoRawKeys(page, `about (${locale})`);

  await page.getByRole('link', { name: nav.settings, exact: true }).click();
  await assertNoRawKeys(page, `settings (${locale})`);
}

test.describe('locale', () => {
  test('switching the UI language never triggers a navigation, and no raw i18n key leaks into visible text on any screen, in any locale', async ({
    page,
  }) => {
    let loadCount = 0;
    page.on('load', () => {
      loadCount++;
    });

    await page.goto('/');

    await test.step('English: home, library, a detail, about, settings', async () => {
      await visitFiveScreens(page, 'en');
    });

    await test.step('switch to Russian from Settings — a live switch, not a navigation', async () => {
      await page.locator('.settings__language-chip[data-locale="ru"]').click();
      await expect(page.locator('.settings__title')).toHaveText('Настройки');
      await assertNoRawKeys(page, 'settings (ru, immediately after switch)');
    });

    await test.step('Russian: home, library, a detail, about, settings', async () => {
      await visitFiveScreens(page, 'ru');
    });

    await test.step('switch to Ukrainian from Settings — a live switch, not a navigation', async () => {
      await page.locator('.settings__language-chip[data-locale="uk"]').click();
      await expect(page.locator('.settings__title')).toHaveText('Налаштування');
      await assertNoRawKeys(page, 'settings (uk, immediately after switch)');
    });

    await test.step('Ukrainian: home, library, a detail, about, settings', async () => {
      await visitFiveScreens(page, 'uk');
    });

    // The whole traversal above — three languages across five screens each, two language
    // switches — is all client-side (Angular Router navigations + live Transloco lang switches);
    // only the very first `page.goto('/')` should ever have fired the browser's `load` event.
    expect(loadCount).toBe(1);
  });

  test('the URL-stripped key-shape check would still catch a raw i18n key (by construction)', () => {
    // A raw, un-interpolated Transloco key never carries a URL scheme — so stripping URLs first
    // cannot hide one. Proven directly here, independent of the app: the about screen's actual
    // attribution URL disappears under the same stripping that leaves a real key shape intact.
    const attributionUrl = 'https://www.dndbeyond.com/srd';
    expect(attributionUrl.replace(URL_RE, '')).not.toMatch(KEY_SHAPE_RE);

    const withLeakedKey = `${attributionUrl}. Structured SRD data derived from about.attribution.title.`;
    expect(withLeakedKey.replace(URL_RE, '')).toMatch(KEY_SHAPE_RE);
  });
});
