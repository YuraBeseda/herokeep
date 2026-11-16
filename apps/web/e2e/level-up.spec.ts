import { expect, test } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';
import { chooseOwnClassIfPrompted } from './helpers/level-up';
import { awardXp, hpCurrent, hpMax, levelUpLink, openTab } from './helpers/sheet';
import { isPhone, openPhoneTab, SHEET_HOME } from './helpers/viewport';

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
      await expect(hpCurrent(page)).toHaveText('12');
      await expect(hpMax(page)).toHaveText('12');
    });

    await test.step('award 300 XP — the "level up available" badge appears', async () => {
      await awardXp(page, 300);
      await expect(page.locator('.sheet-shell__xp-current')).toHaveText('XP: 300');
      await expect(await levelUpLink(page)).toBeVisible();
    });

    await test.step('the level-up dims the sheet tabs, and Cancel returns to the tab the player came from', async () => {
      await (await levelUpLink(page)).click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/level-up$/);
      if (isPhone(page)) {
        // The phone has no sheet tabs to dim: the bottom bar keeps More lit for the wizard.
        await expect(
          page
            .getByRole('navigation', { name: 'Sections of this screen' })
            .getByRole('link', { name: 'More', exact: true }),
        ).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(page.locator('.sheet-shell__tab[aria-disabled="true"]')).toHaveCount(3);
        await expect(page.locator('.sheet-shell__level-up-badge')).toHaveAttribute(
          'aria-current',
          'page',
        );
      }
      await page.locator('[data-action="cancel"]').click();
      await expect(page).toHaveURL(SHEET_HOME);
      if (!isPhone(page)) {
        await expect(page.locator('.sheet-shell__tab[aria-disabled="true"]')).toHaveCount(0);
      }
    });

    await test.step('open the level-up wizard and take the average HP', async () => {
      await (await levelUpLink(page)).click();
      await expect(page).toHaveURL(/\/c\/[^/]+\/level-up$/);
      // Fighter-1's own ability scores clear a multiclass offer (see `chooseOwnClassIfPrompted`'s
      // doc) — keep leveling Fighter.
      await chooseOwnClassIfPrompted(page);
      await page.locator('.level-up__hp-average').click();
      await expect(page.locator('.level-up__hp-result')).toHaveText('Taking the average.');
    });

    await test.step('finish the level up', async () => {
      await page.locator('[data-action="next"]').click();
      await expect(page.locator('.level-up__review')).toBeVisible();
      await expect(page.locator('.level-up__summary')).toContainText('20');
      // The Next slot now reads "Finish level up".
      await expect(page.locator('[data-action="next"]')).toContainText('Finish level up');
      await page.locator('[data-action="next"]').click();
      await expect(page).toHaveURL(SHEET_HOME);
    });

    await test.step('the sheet shows level 2 and HP 12/20 (leveling does not heal current)', async () => {
      // The phone returns to the tab it left (More); HP lives on Combat.
      if (isPhone(page)) await openPhoneTab(page, 'Combat');
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      await expect(hpCurrent(page)).toHaveText('12');
      await expect(hpMax(page)).toHaveText('20');
    });

    await test.step('a reload persists the level up (IndexedDB, not just in-memory state)', async () => {
      await page.reload();
      if (isPhone(page)) await openPhoneTab(page, 'Combat'); // the reload may land on another tab
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 2');
      await expect(hpCurrent(page)).toHaveText('12');
      await expect(hpMax(page)).toHaveText('20');
    });

    await test.step('revert the level up from the Timeline tab, behind its confirm dialog', async () => {
      await openTab(page, 'Timeline');
      // Scoped to the 'leveling' family (`event-sentence.pipe.ts`'s `FAMILY_BY_PREFIX`, which
      // maps both `level.*` and `xp.*` to it) rather than just "the first row": the XP award is
      // ALSO a 'leveling' row, so `.first()` over that narrower set is what actually picks the
      // level-up row specifically (still the newer of the two) — and stays correct even after
      // reverting prepends a new row, since `event.reverted` itself falls in family 'other', not
      // 'leveling' (this locator, unlike a plain element reference, re-queries the DOM live).
      const levelUpRow = page.locator('.timeline-tab__row[data-family="leveling"]').first();
      await levelUpRow.getByRole('button', { name: /^Revert/ }).click();

      await expect(page.locator('.timeline-revert-confirm__title')).toBeVisible();
      await page.locator('.timeline-revert-confirm__confirm').click();

      await expect(levelUpRow.locator('.timeline-tab__badge')).toHaveText('Reverted');
    });

    await test.step('the sheet is back to level 1 / HP 12/12', async () => {
      await openTab(page, 'Play');
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      await expect(hpCurrent(page)).toHaveText('12');
      await expect(hpMax(page)).toHaveText('12');
    });
  });

  // R43: one hit point roll per level, kept on the device while the player leaves and returns.
  test('a rolled hit die survives leaving the level up; Roll and the average stay closed; the sheet max includes the roll', async ({
    page,
  }) => {
    await createFighter(page, CHARACTER_NAME);
    await awardXp(page, 300);
    await (await levelUpLink(page)).click();
    await chooseOwnClassIfPrompted(page);
    await page.locator('.level-up__hp-roll').click();
    const die = page.locator('.level-up__hp-die');
    await expect(die).toHaveCount(1);
    const rolled = Number((await die.textContent())?.trim());

    // Leave (a reload drops all in-memory state) and come back to the same level up.
    await page.reload();
    await chooseOwnClassIfPrompted(page);
    await expect(die).toHaveText(String(rolled));
    await expect(page.locator('.level-up__hp-roll')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.level-up__hp-average')).toHaveAttribute('aria-disabled', 'true');

    await page.locator('[data-action="next"]').click();
    await expect(page.locator('.level-up__review')).toBeVisible();
    await page.locator('[data-action="next"]').click();
    await expect(page).toHaveURL(SHEET_HOME);
    if (isPhone(page)) await openPhoneTab(page, 'Combat');
    await expect(hpMax(page)).toHaveText(String(12 + rolled + 2)); // 12 + die + Constitution mod
  });
});
