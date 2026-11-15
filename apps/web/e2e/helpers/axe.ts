import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The impact levels that fail an axe check; minor and moderate findings are not gated. */
const SERIOUS_IMPACTS = new Set(['serious', 'critical']);

/**
 * Runs axe-core against the current page and fails on any serious/critical violation. Shared by the
 * offline `a11y.spec.ts` and the sync project (plan 16 task 8: the campaign settings screen needs an
 * account and a campaign, so its scan lives in `sync/campaign-packs.spec.ts`).
 */
export async function assertNoSeriousViolations(page: Page, screen: string): Promise<void> {
  // Let running CSS transitions settle first: `hk-button`'s base style is the accent fill and a
  // ghost/danger variant class lands on first change detection, so a just-rendered ghost button
  // transitions its background for `--duration-fast`. Measured mid-transition, axe reports a
  // contrast failure that no settled screen has (a load-timing race; plan 15 Task 4 fix round 1).
  // Only transitions are awaited — infinite animations (the skeleton shimmer) never finish.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => SERIOUS_IMPACTS.has(v.impact ?? ''));
  expect(serious, `${screen}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}
