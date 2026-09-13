import { expect, test } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Level Up';

// Controller ruling R11: creation tops HP up to full (`CreateWizardState.buildTransaction()`
// appends an `hp.changed {delta: <derived max>, kind: 'set'}` right after `level.gained`), so
// this character starts at current/max 12/12. Leveling up, unlike creation, does NOT heal —
// `LevelUpState.buildTransaction()` only ever appends `level.gained`/`decision.made`s/spell
// drafts, never an `hp.changed` — so current STAYS at 12 while max grows to 20 (12/20, not
// 20/20), and reverting the level-up brings max back down to 12 without ever having touched
// current at all (still 12 throughout).
test.describe('level up — XP entry, average HP, and revert', () => {
  // task-15-brief.md: XP 300 -> the "level up available" badge -> the level-up wizard, taking
  // AVERAGE hit points -> the sheet shows level 2 / HP 12/20 (max: 12 + 6 [d10 average, rounded
  // up] + 2 [Constitution mod]) — matches `packages/engine/test/golden/fighter-2.json` exactly
  // (XP 300, `hpRoll: 'average'`, `sheet.hp.max.value: 20`). A `page.reload()` mid-test proves the
  // level-up persisted to IndexedDB, not just in-memory state. Then: revert the level-up from the
  // Timeline tab (behind its confirm dialog) and confirm the sheet is back to level 1 / HP 12/12.
  test('XP 300 triggers a level up; taking average HP reaches level 2 / HP 12/20 (leveling does not heal); reload persists it; reverting from the timeline returns the sheet to level 1 / HP 12/12', async ({
    page,
  }) => {
    await test.step('create the fighter-1 character (level 1, HP 12/12)', async () => {
      await createFighter(page, CHARACTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
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

    await test.step('the sheet shows level 2 and HP 12/20 (leveling does not heal current)', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('20');
    });

    await test.step('a reload persists the level up (IndexedDB, not just in-memory state)', async () => {
      await page.reload();
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
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

    await test.step('the sheet is back to level 1 / HP 12/12', async () => {
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
    });
  });
});
