import { expect, test } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Level Up';

// Current HP stays `0` throughout this whole test (never `12`/`20`, despite what an "HP 12/12" /
// "HP 20/20" phrasing might suggest): `facts.hp.current` defaults to the literal `0`, not the
// `'max'` sentinel (`reduce/facts.ts`'s `initialFacts`), and nothing in this flow ever appends an
// `hp.changed` event (no damage/heal/rest) to move it off that default — `level.gained` itself
// never touches `hp.current` either (`reduce/handlers/leveling.ts`). This is documented,
// intentional behavior (`packages/engine/test/derive/hp.test.ts` covers the clamp explicitly):
// task-10-report.md hit this exact assumption in a unit test — "renders fighter-1's hp max / AC /
// proficiency bonus straight off the store's sheet (12/19/+2)" — and fixed the ASSERTION, not the
// component. Only HP MAX moves here (12 -> 20 -> back to 12); this file asserts current HP too,
// at 0 throughout, so a regression that started writing a stray `hp.changed` would still be
// caught.
test.describe('level up — XP entry, average HP, and revert', () => {
  // task-15-brief.md: XP 300 -> the "level up available" badge -> the level-up wizard, taking
  // AVERAGE hit points -> the sheet shows level 2 / HP max 20 (12 + 6 [d10 average, rounded up] +
  // 2 [Constitution mod]) — matches `packages/engine/test/golden/fighter-2.json` exactly (XP 300,
  // `hpRoll: 'average'`, `sheet.hp.max.value: 20`). A `page.reload()` mid-test proves the level-up
  // persisted to IndexedDB, not just in-memory state. Then: revert the level-up from the Timeline
  // tab (behind its confirm dialog) and confirm the sheet is back to level 1 / HP max 12.
  test('XP 300 triggers a level up; taking average HP reaches level 2 / HP max 20; reload persists it; reverting from the timeline returns the sheet to level 1 / HP max 12', async ({
    page,
  }) => {
    await test.step('create the fighter-1 character (level 1, HP max 12)', async () => {
      await createFighter(page, CHARACTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
    });

    await test.step('award 300 XP — the "level up available" badge appears', async () => {
      await page.locator('.sheet-shell__xp-field input').fill('300');
      await page.locator('.sheet-shell__xp-submit').click();
      await expect(page.locator('.sheet-shell__xp-current')).toHaveText('XP: 300');
      await expect(page.locator('.sheet-shell__level-up-badge')).toBeVisible();
    });

    await test.step('open the level-up wizard and take the average HP', async () => {
      await page.locator('.sheet-shell__level-up-badge').click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/level-up$/);
      await page.locator('.level-up__hp-average').click();
      await expect(page.locator('.level-up__hp-result')).toHaveText('Taking the average.');
    });

    await test.step('finish the level up', async () => {
      await page.locator('.level-up__next').click();
      await expect(page.locator('.level-up__review')).toBeVisible();
      await expect(page.locator('.level-up__summary')).toContainText('20');
      await page.locator('.level-up__finish').click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
    });

    await test.step('the sheet shows level 2 and HP max 20', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('0');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('20');
    });

    await test.step('a reload persists the level up (IndexedDB, not just in-memory state)', async () => {
      await page.reload();
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('20');
    });

    await test.step('revert the level up from the Timeline tab, behind its confirm dialog', async () => {
      await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
      // Scoped to the 'leveling' family (`event-sentence.pipe.ts`'s `FAMILY_BY_PREFIX`, which
      // maps both `level.*` and `xp.*` to it) rather than just "the first row": the XP award is
      // ALSO a 'leveling' row, so `.first()` over that narrower set is what actually picks the
      // level-up row specifically (still the newer of the two) — and stays correct even after
      // reverting prepends a new row, since `event.reverted` itself falls in family 'other', not
      // 'leveling' (this locator, unlike a plain element reference, re-queries the DOM live).
      const levelUpRow = page.locator('.timeline-tab__row[data-family="leveling"]').first();
      await levelUpRow.getByRole('button', { name: 'Revert', exact: true }).click();

      await expect(page.locator('.timeline-revert-confirm__title')).toBeVisible();
      await page.locator('.timeline-revert-confirm__confirm').click();

      await expect(levelUpRow.locator('.timeline-tab__badge')).toHaveText('Reverted');
    });

    await test.step('the sheet is back to level 1 / HP max 12', async () => {
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('0');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
    });
  });
});
