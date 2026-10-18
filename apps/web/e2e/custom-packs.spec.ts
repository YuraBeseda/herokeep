import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  applyBackgroundAbilities,
  assignStandardArray,
  finishReviewAndCreate,
  pickBackground,
  pickClass,
  pickGamingSet,
  pickSkills,
} from './helpers/create-fighter';

/**
 * Plan 15 (Phase 4 slice 5) task 9: the custom pack platform end to end, offline, against the real
 * production build. Every pack enters through the real UI: the checked-in `.hkpack` fixtures (task 8,
 * `e2e/fixtures/packs/`, rebuilt deterministically by `build.ts`) go through `/packs`' hidden file
 * input, the homebrew item through the `/packs/homebrew` form, and the `.hero` round trip through
 * the characters list's import input.
 *
 * One test, many steps: every step builds on the IndexedDB state of the ones before it (installed
 * packs, the character's pins and events), and Playwright gives each `test()` a fresh browser
 * context, so splitting it would mean re-driving the whole setup per block.
 *
 * `sample-content-v2.hkpack` keeps `item/moonblade-sickle` (marked `deprecated.replacedBy
 * item/moonsilver-sickle`) and adds the renamed weapon. The rebase migrates the Weapon Masteries
 * DECISION to the new id; the inventory row keeps the old item id (plan 15 task 8 owner-flag,
 * pinned by the `pack-updated-v2` golden). So after the update the old sickle still resolves and
 * still attacks, but without its mastery, and a freshly added Moonsilver Sickle attacks WITH it.
 */

const V1_HKPACK = path.join(__dirname, 'fixtures', 'packs', 'sample-content.hkpack');
const V2_HKPACK = path.join(__dirname, 'fixtures', 'packs', 'sample-content-v2.hkpack');
const CHARACTER_NAME = 'Selene Moonkin';
const PACK_NAME = 'Sample content';
const HOMEBREW_PACK_NAME = 'My homebrew';
const HOMEBREW_ITEM = 'Starlit Lantern';

/** The species step (Moonkin, from the pinned pack) up to Equipment; the fighter helpers drive the
 * core steps exactly as `createFighter` does. Weapon Masteries takes the pack's Moonblade Sickle so
 * the v2 rebase has a decision to migrate. */
async function pickFightingStyleAndMasteries(page: Page): Promise<void> {
  const picks = ['Moonblade Sickle', 'Longsword', 'Shortsword'];
  for (let i = 0; i < 2; i++) {
    const title = page.locator('.choice-step__title');
    await title.waitFor({ state: 'visible' });
    if ((await title.textContent())?.trim() === 'Weapon Masteries') {
      for (const weapon of picks) {
        await page.getByRole('button', { name: weapon, exact: true }).click();
      }
      await page
        .getByRole('button', { name: picks[picks.length - 1], exact: true })
        .waitFor({ state: 'detached' });
    } else {
      const defense = page.getByRole('button', { name: 'Defense', exact: true });
      await defense.click();
      await defense.waitFor({ state: 'detached' });
    }
  }
}

async function importPack(page: Page, file: string): Promise<Locator> {
  await page.goto('/packs');
  await expect(page.locator('.packs-list')).toBeVisible();
  // `setInputFiles` on the hidden input, never a click on the visible Import button (that would
  // pop a native picker headless Chromium cannot drive) — same as `export-import.spec.ts`.
  await page.locator('.packs-list__import-input').setInputFiles(file);
  const dialog = page.locator('.pack-trust-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

function speedTile(page: Page): Locator {
  return page
    .locator('.play-tab hk-stat-tile', { hasText: 'Speed' })
    .locator('.hk-stat-tile__value');
}

function attackRow(page: Page, weapon: string): Locator {
  return page.locator('.play-tab__attacks tbody tr', { hasText: weapon });
}

/** The Play tab's "Add from library" dialog: search, then pick. Picking closes the dialog. */
async function addFromLibrary(page: Page, search: string, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Add from library', exact: true }).click();
  const dialog = page.locator('hk-dialog', { has: page.locator('.add-item-dialog__title') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox').fill(search);
  await dialog.getByRole('button', { name: item, exact: true }).click();
  await expect(page.locator('.add-item-dialog__title')).toHaveCount(0);
}

async function equip(page: Page, item: string): Promise<void> {
  const row = page.locator('.play-tab__inventory-item', { hasText: item });
  await row.getByRole('button', { name: 'Equip', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Unequip', exact: true })).toBeVisible();
}

async function openTab(page: Page, tab: 'Play' | 'Build' | 'Timeline'): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.locator(`.${tab.toLowerCase()}-tab`)).toBeVisible();
}

async function removeInstalledPack(page: Page, version: string): Promise<void> {
  await page.goto('/packs');
  await page
    .locator('.packs-list__content .packs-list__row', { hasText: PACK_NAME })
    .filter({ hasText: version })
    .click();
  await expect(page.locator('.pack-detail__title')).toHaveText(PACK_NAME);
  await page.locator('.pack-detail__remove').click();
  await page.locator('.pack-remove-confirm__confirm').click();
  await expect(page).toHaveURL(/\/packs$/);
}

test.describe('custom content packs', () => {
  test('import a .hkpack, build with it, update with a rebase report, pin homebrew, and round-trip the packs through .hero', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Same delivery-ladder stub as `export-import.spec.ts`: fall through to the `<a download>` rung.
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });

    await test.step('import sample-content.hkpack: the trust screen lists its contents; Install', async () => {
      const dialog = await importPack(page, V1_HKPACK);
      await expect(dialog.locator('.pack-trust-dialog__title')).toHaveText(`Install ${PACK_NAME}?`);
      for (const type of ['item', 'spell', 'feat', 'species']) {
        await expect(
          dialog.locator(`.pack-info__count[data-type="${type}"] .pack-info__count-value`),
        ).toHaveText('1');
      }
      await expect(dialog.locator('.pack-info__assets')).toContainText('1 image');
      await dialog.locator('.pack-trust-dialog__install').click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.locator('.packs-list__content .packs-list__row', { hasText: PACK_NAME }),
      ).toContainText('1.0.0');
    });

    let characterId = '';
    await test.step('create a fighter with the pack checked in the wizard; the pack species is offered and chosen', async () => {
      await page.goto('/characters/new');
      await page.locator('.create-wizard__name-input').fill(CHARACTER_NAME);
      await page.getByRole('radio', { name: 'Masculine', exact: true }).check();
      await page
        .locator('.create-wizard__pack', { hasText: PACK_NAME })
        .locator('.create-wizard__pack-toggle')
        .check();
      await page.locator('.create-wizard__next').click();
      await page.getByRole('button', { name: 'Moonkin', exact: true }).click();
      await pickBackground(page);
      await applyBackgroundAbilities(page);
      await pickClass(page);
      await assignStandardArray(page);
      await pickSkills(page);
      await pickGamingSet(page);
      await pickFightingStyleAndMasteries(page);
      // Equipment (never choice-gated): nothing to add here; the weapon comes from the sheet.
      await page.locator('.create-wizard__next').click();
      characterId = await finishReviewAndCreate(page);
    });

    await test.step('the sheet derives from the pack: Moonkin walking speed, Moonkin in the timeline', async () => {
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
      await expect(speedTile(page)).toHaveText('30');
      await openTab(page, 'Timeline');
      await expect(page.locator('.timeline-tab')).toContainText('Moonkin');
      await expect(page.locator('.timeline-tab')).toContainText(`Pinned ${PACK_NAME} v1.0.0.`);
    });

    await test.step('add the pack weapon from the library and equip it: an attack row with its mastery', async () => {
      await openTab(page, 'Play');
      await addFromLibrary(page, 'Moonblade', 'Moonblade Sickle');
      await equip(page, 'Moonblade Sickle');
      await expect(attackRow(page, 'Moonblade Sickle')).toHaveCount(1);
      await expect(attackRow(page, 'Moonblade Sickle').locator('td').nth(3)).toHaveText('nick');
    });

    await test.step('import sample-content-v2.hkpack: /packs badges the newer version', async () => {
      const dialog = await importPack(page, V2_HKPACK);
      await expect(
        dialog.locator('.pack-info__count[data-type="item"] .pack-info__count-value'),
      ).toHaveText('2');
      await dialog.locator('.pack-trust-dialog__install').click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page
          .locator('.packs-list__content .packs-list__row', { hasText: PACK_NAME })
          .filter({ hasText: '1.1.0' })
          .locator('.packs-list__update'),
      ).toHaveText('Update available');
    });

    await test.step('Build tab: Update available → the rebase report lists the migration → Confirm', async () => {
      await page.goto(`/c/${characterId}/build`);
      const row = page.locator('.build-packs__row[data-pack-id="sample-content"]');
      await expect(row.locator('.build-packs__update-badge')).toHaveText(
        'Update available: v1.0.0 → v1.1.0',
      );
      await row.locator('.build-packs__update').click();
      const report = page.locator('.rebase-report');
      await expect(report.locator('.rebase-report__title')).toHaveText(
        `Update ${PACK_NAME} v1.0.0 → v1.1.0?`,
      );
      await expect(report.locator('.rebase-report__migration')).toHaveText(
        'Weapon Masteries: Moonblade Sickle → Moonsilver Sickle',
      );
      await expect(report.locator('.rebase-report__invalid-item')).toHaveCount(0);
      await report.locator('.rebase-report__confirm').click();
      await expect(report).toHaveCount(0);
      await expect(row.locator('.build-packs__update-badge')).toHaveCount(0);
      await expect(row.locator('.build-packs__version')).toContainText('1.1.0');
    });

    await test.step('after the update: the decision names the renamed weapon; the inventory row keeps the old id', async () => {
      await openTab(page, 'Play');
      // The deprecated entity is still in v2, so the old inventory row still resolves and attacks,
      // but the migrated mastery decision no longer names it (task 8 owner-flag).
      await expect(attackRow(page, 'Moonblade Sickle').locator('td').nth(3)).toHaveText('');
      await addFromLibrary(page, 'Moonsilver', 'Moonsilver Sickle');
      await equip(page, 'Moonsilver Sickle');
      await expect(attackRow(page, 'Moonsilver Sickle').locator('td').nth(3)).toHaveText('nick');
      await openTab(page, 'Timeline');
      await expect(page.locator('.timeline-tab')).toContainText(
        `Updated ${PACK_NAME} v1.0.0 → v1.1.0.`,
      );
    });

    await test.step('homebrew: create an item in /packs/homebrew', async () => {
      await page.goto('/packs/homebrew');
      await page.locator('.hb-list__new-link[data-type="item"]').click();
      await page.locator('.hb-form__name').fill(HOMEBREW_ITEM);
      await page.locator('.hb-form__save').click();
      await expect(page).toHaveURL(/\/packs\/homebrew$/);
      await expect(page.locator('.hb-list__row', { hasText: HOMEBREW_ITEM })).toBeVisible();
    });

    await test.step('pin the homebrew pack on the Build tab; its item appears in the add-item picker', async () => {
      await page.goto(`/c/${characterId}/build`);
      const row = page.locator('.build-packs__row', { hasText: HOMEBREW_PACK_NAME });
      const toggle = row.locator('.build-packs__toggle');
      await expect(toggle).not.toBeChecked();
      // `click`, not `check`: the section resets the box to the model value on `change` and the
      // pin lands asynchronously (one `appendTx`), so the checked state follows a tick later.
      await toggle.click();
      await expect(toggle).toBeChecked();
      await openTab(page, 'Play');
      await addFromLibrary(page, 'Starlit', HOMEBREW_ITEM);
      await expect(
        page.locator('.play-tab__inventory-item', { hasText: HOMEBREW_ITEM }),
      ).toBeVisible();
    });

    let heroFilePath = '';
    await test.step('export the character as .hero', async () => {
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.sheet-shell__export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`${CHARACTER_NAME}.hero`);
      const savedPath = await download.path();
      if (!savedPath) throw new Error('download.path() returned null — no local file to re-import');
      heroFilePath = savedPath;
    });

    await test.step('remove both sample pack versions: the sheet shows the missing-pack banner', async () => {
      await removeInstalledPack(page, '1.1.0');
      await removeInstalledPack(page, '1.0.0');
      await expect(
        page.locator('.packs-list__content .packs-list__row', { hasText: PACK_NAME }),
      ).toHaveCount(0);
      await page.goto(`/c/${characterId}/play`);
      const banner = page.locator('.sheet-shell__missing-packs');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('sample-content@1.1.0');
      // The species is unresolved without its pack: the walking speed falls back to 0.
      await expect(speedTile(page)).toHaveText('0');
    });

    await test.step('import the .hero: the carried pack is reinstalled and the sheet is intact', async () => {
      await page.goto('/characters');
      await page.locator('.characters-list__import-input').setInputFiles(heroFilePath);
      await expect(page.getByText(`${CHARACTER_NAME} updated:`)).toBeVisible();
      await page.goto('/packs');
      await expect(
        page.locator('.packs-list__content .packs-list__row', { hasText: PACK_NAME }),
      ).toContainText('1.1.0');
      await page.goto(`/c/${characterId}/play`);
      await expect(page.locator('.sheet-shell__name')).toHaveText(CHARACTER_NAME);
      await expect(speedTile(page)).toHaveText('30');
      await expect(page.locator('.sheet-shell__missing-packs')).toHaveCount(0);
      await expect(attackRow(page, 'Moonsilver Sickle').locator('td').nth(3)).toHaveText('nick');
      await expect(
        page.locator('.play-tab__inventory-item', { hasText: HOMEBREW_ITEM }),
      ).toBeVisible();
    });
  });
});
