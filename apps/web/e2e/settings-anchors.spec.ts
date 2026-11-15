import { expect, test, type Page } from '@playwright/test';

// The router schedules its scroll on the first of a task or an animation frame after the
// navigation; two frames plus a task means it has run, so a position read after this is held.
const routerScrollSettled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve))),
      ),
  );

// R73 follow-up: a section link scrolls to its section; the router's scroll-to-top must not undo it.
test('a settings index link scrolls to its section, and again on a re-click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('/settings');
  const link = page.locator('.settings__index-link[data-section="about"]');
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/settings#about$/);
  const heading = page.locator('#about h2');
  // The router scrolls after the navigation settles; poll until the page rests away from the top.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await routerScrollSettled(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(heading).toBeInViewport();
  await expect(heading).toBeFocused();

  // Re-clicking the same link (same URL, no navigation) still brings the section back.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await link.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await routerScrollSettled(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(heading).toBeInViewport();
  await expect(heading).toBeFocused();
});
