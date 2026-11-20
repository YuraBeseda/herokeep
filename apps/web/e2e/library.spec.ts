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

    // R74: Back (in-app and browser) also returns to where the page and the list were scrolled to.
    await page.locator('.hk-search__clear').click();
    await expect(page).not.toHaveURL(/q=/);
    const rows = page.locator('.library-browse__row');
    await expect(rows.first()).toBeVisible();
    const viewport = page.locator('.hk-virtual-list__viewport');
    const listOffset = () => viewport.evaluate((el) => el.scrollTop);
    await viewport.evaluate((el) => (el.scrollTop = 1500));
    await page.evaluate(() => window.scrollTo(0, 900));
    const before = await page.evaluate(() => window.scrollY);
    const listBefore = await listOffset();
    expect(before).toBeGreaterThan(20);
    expect(listBefore).toBeGreaterThan(1000);
    const expectRestored = async () => {
      await expect(rows.first()).toBeVisible();
      await expect
        .poll(async () => Math.abs((await listOffset()) - listBefore))
        .toBeLessThanOrEqual(50);
      await expect
        .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before))
        .toBeLessThanOrEqual(50);
    };
    // A DOM click, so Playwright does not scroll the page before it.
    await rows.first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.library-detail__name')).toBeVisible();
    await page.locator('.library-detail__back').click();
    await expectRestored();

    await rows.first().evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.library-detail__name')).toBeVisible();
    await page.goBack();
    await expectRestored();
  });
  test('a subclass link in the class entry opens the side panel and keeps the URL', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const url = `/library/${encodeURIComponent('srd-5e-2024:class/paladin')}`;
    await page.goto(url);
    await expect(page.locator('a.class-entry__link').first()).toBeVisible();
    const before = page.url();
    await page.locator('a.class-entry__link', { hasText: 'Oath of Devotion' }).first().click();
    await expect(page.locator('.hk-drawer__panel h2')).toHaveText('Oath of Devotion');
    expect(page.url()).toBe(before);
  });
  test('peek drawer opens without layout shift and scrolls itself', async ({ page }) => {
    // Short enough that the subclass text overflows the panel; still the desktop (>= 900 px) layout.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto(`/library/${encodeURIComponent('srd-5e-2024:class/paladin')}`);
    const button = page
      .locator('li', { hasText: 'Oath of Devotion' })
      .locator('.class-entry__more')
      .first();
    await expect(button).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);

    // Sample the main column's x and the page scroll every frame while the drawer opens, until
    // the panel is attached and its slide-in has finished (the deferred host loads on demand).
    const samples = await button.evaluate(async (el) => {
      const main = document.querySelector('.app-shell__main')!;
      const root = document.scrollingElement!;
      const out: { x: number; top: number }[] = [];
      (el as HTMLElement).click();
      const settled = () => {
        const panel = document.querySelector('.hk-drawer__panel');
        return !!panel && panel.getAnimations({ subtree: true }).length === 0;
      };
      const end = performance.now() + 5000;
      do {
        out.push({ x: main.getBoundingClientRect().x, top: root.scrollTop });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      } while (!settled() && performance.now() < end);
      out.push({ x: main.getBoundingClientRect().x, top: root.scrollTop });
      return { out, settled: settled() };
    });
    expect(samples.settled).toBe(true);
    const first = samples.out[0]!;
    expect(samples.out.every((s) => s.x === first.x && s.top === 600)).toBe(true);

    const panel = page.locator('.hk-drawer__panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('h2')).toHaveText('Oath of Devotion');
    // Non-modal on desktop: no backdrop.
    await expect(page.locator('.hk-drawer__scrim')).toBeHidden();

    // Above the strap and the nav: once it has slid in, the point at its centre is inside it.
    await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0);
    const onTop = await panel.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);

    // The drawer scrolls itself; the page does not move with it.
    const body = panel.locator('.hk-drawer__body');
    expect(await body.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    // The rendered text arrives a tick after the heading.
    await expect
      .poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(0);
    const pageTop = () => page.evaluate(() => window.scrollY);
    const panelBox = (await panel.boundingBox())!;
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await pageTop()).toBe(600);

    // The wheel over the page still scrolls the page while the drawer stays open.
    await page.mouse.move(panelBox.x / 2, 200);
    await page.mouse.wheel(0, 200);
    await expect.poll(pageTop).toBeGreaterThan(600);
    await expect(panel).toBeVisible();

    // Escape closes it; focus returns to the opener.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
