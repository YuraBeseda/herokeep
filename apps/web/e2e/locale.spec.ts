import { expect, test, type Page } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';

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
  readonly characters: string;
  readonly settings: string;
  readonly about: string;
}

const NAV: Record<Locale, NavLabels> = {
  en: {
    home: 'Home',
    library: 'Library',
    characters: 'Characters',
    settings: 'Settings',
    about: 'About',
  },
  ru: {
    home: 'Главная',
    library: 'Библиотека',
    characters: 'Персонажи',
    settings: 'Настройки',
    about: 'О приложении',
  },
  uk: {
    home: 'Головна',
    library: 'Бібліотека',
    characters: 'Персонажі',
    settings: 'Налаштування',
    about: 'Про застосунок',
  },
};

interface SheetTabLabels {
  readonly build: string;
  readonly timeline: string;
}

// 'play' isn't needed separately — `/c/:id` redirects straight to it, so opening a character
// from the list already lands on that tab.
const SHEET_TABS: Record<Locale, SheetTabLabels> = {
  en: { build: 'Build', timeline: 'Timeline' },
  ru: { build: 'Билд', timeline: 'Хроника' },
  uk: { build: 'Білд', timeline: 'Хроніка' },
};

/** Asserts none of the page's currently visible text looks like a raw, un-interpolated i18n key. */
async function assertNoRawKeys(page: Page, screen: string): Promise<void> {
  const text = (await page.locator('body').innerText()).replace(URL_RE, '');
  expect(text, `${screen}: visible text looks like a raw i18n key`).not.toMatch(KEY_SHAPE_RE);
}

/**
 * Visits home/library/a library detail/the characters list/a character sheet's play+build+
 * timeline tabs/about/settings (task-15-brief.md extends the original five-screen a11y list with
 * `/characters` and the sheet tabs — the plan's binding criterion is "no visible key names
 * *anywhere*") in the given locale, ending on settings so the caller can switch language and
 * continue. Assumes the app is already on some screen in this locale (a live Transloco switch,
 * not a navigation) and that `characterId` already exists (seeded once, in English, before the
 * very first call — see this file's own test for why: creating a character is itself several
 * client-side-only navigations, so seeding it inside the locale loop would work too, but doing it
 * once up front means the same character is reused, rather than re-created, on every pass).
 */
async function visitScreens(page: Page, locale: Locale, characterId: string): Promise<void> {
  const nav = NAV[locale];
  const tabs = SHEET_TABS[locale];

  await page.getByRole('link', { name: nav.home, exact: true }).click();
  await assertNoRawKeys(page, `home (${locale})`);

  await page.getByRole('link', { name: nav.library, exact: true }).click();
  await assertNoRawKeys(page, `library (${locale})`);

  await page.locator('.library-browse__row').first().click();
  await expect(page.locator('.library-detail__name')).toBeVisible();
  await assertNoRawKeys(page, `library detail (${locale})`);

  await page.getByRole('link', { name: nav.characters, exact: true }).click();
  await expect(page.locator('.characters-list__open')).toBeVisible();
  await assertNoRawKeys(page, `characters list (${locale})`);

  await page.locator('.characters-list__open').first().click();
  await expect(page).toHaveURL(new RegExp(`/c/${characterId}/play$`));
  await expect(page.locator('.play-tab')).toBeVisible();
  await assertNoRawKeys(page, `character sheet — play (${locale})`);

  await page.getByRole('tab', { name: tabs.build, exact: true }).click();
  await expect(page.locator('.build-tab')).toBeVisible();
  await assertNoRawKeys(page, `character sheet — build (${locale})`);

  await page.getByRole('tab', { name: tabs.timeline, exact: true }).click();
  await expect(page.locator('.timeline-tab')).toBeVisible();
  await assertNoRawKeys(page, `character sheet — timeline (${locale})`);

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

    // Seeded once, in English, via client-side-only navigation (`via: 'nav'` — see
    // `openCreateWizard`'s doc): the creation wizard never calls `page.goto` itself, so this adds
    // zero `load` events, and the same character is then reused (never re-created) for every
    // locale pass below.
    const characterId = await test.step('seed a character for the sheet screens below', () =>
      createFighter(page, 'Aldric Locale', 'nav'));

    await test.step('English: home, library, a detail, characters + sheet tabs, about, settings', async () => {
      await visitScreens(page, 'en', characterId);
    });

    await test.step('switch to Russian from Settings — a live switch, not a navigation', async () => {
      await page.locator('.settings__language-chip[data-locale="ru"]').click();
      await expect(page.locator('.settings__title')).toHaveText('Настройки');
      await assertNoRawKeys(page, 'settings (ru, immediately after switch)');
    });

    await test.step('Russian: home, library, a detail, characters + sheet tabs, about, settings', async () => {
      await visitScreens(page, 'ru', characterId);
    });

    await test.step('switch to Ukrainian from Settings — a live switch, not a navigation', async () => {
      await page.locator('.settings__language-chip[data-locale="uk"]').click();
      await expect(page.locator('.settings__title')).toHaveText('Налаштування');
      await assertNoRawKeys(page, 'settings (uk, immediately after switch)');
    });

    await test.step('Ukrainian: home, library, a detail, characters + sheet tabs, about, settings', async () => {
      await visitScreens(page, 'uk', characterId);
    });

    // The whole traversal above — three languages across nine screens each (the original five
    // plus task-15-brief.md's /characters + the sheet's play/build/timeline tabs), two language
    // switches, plus seeding the character itself — is all client-side (Angular Router
    // navigations + live Transloco lang switches); only the very first `page.goto('/')` should
    // ever have fired the browser's `load` event.
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
