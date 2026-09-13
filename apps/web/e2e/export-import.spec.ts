import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createFighter } from './helpers/create-fighter';

const CHARACTER_NAME = 'Aldric Export Import';
const PORTRAIT_FIXTURE = path.join(__dirname, 'fixtures', 'tiny-portrait.png');

test.describe('export / import (.hero)', () => {
  // task-12-brief.md scenario (c): upload a portrait (the real image pipeline, the only real-codec
  // coverage this e2e suite gives it — task-8-brief.md), export the character (a real browser
  // download), delete it, re-import the SAME downloaded file, and confirm the character comes back
  // with its name, HP, and portrait thumb intact.
  test('upload a portrait, export, delete, re-import: name/HP/portrait survive the round trip', async ({
    page,
  }) => {
    // `hero-delivery.ts`'s own delivery ladder tries `window.showSaveFilePicker` first. Headless
    // Chromium exposes that API (File System Access), but there is no real user to drive its native
    // save dialog — whether the resulting promise rejects, hangs, or misbehaves isn't something to
    // depend on here. Stubbing it (and `navigator.share`, the next rung) undefined BEFORE any
    // navigation is the deliberate, documented way to make the ladder fall through to its THIRD
    // rung — a plain `<a download>` click — deterministically, so Playwright's own `download` event
    // fires reliably. This is the real writer (`HeroWriterService.export`) plus the real fallback
    // delivery path; only the picker/share rungs above it are skipped. No production code changes.
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });

    let characterId = '';
    await test.step('create the fighter-1 character (level 1, HP 12/12)', async () => {
      characterId = await createFighter(page, CHARACTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');
    });

    await test.step('upload a portrait via the Build tab (real image pipeline, real codec)', async () => {
      await page.getByRole('tab', { name: 'Build', exact: true }).click();
      await expect(page.locator('.build-tab')).toBeVisible();
      await page.locator('.build-tab__portrait-input').setInputFiles(PORTRAIT_FIXTURE);
      await expect(page.locator('img.build-tab__portrait-preview')).toBeVisible();
    });

    let heroFilePath = '';
    await test.step('export: a real browser download, delivered via the <a download> fallback rung', async () => {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('tab', { name: 'Play', exact: true }).click();
      await page.locator('.sheet-shell__export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('Aldric Export Import.hero');
      const savedPath = await download.path();
      if (!savedPath) throw new Error('download.path() returned null — no local file to re-import');
      heroFilePath = savedPath;
    });

    await test.step('delete the character from the list', async () => {
      await page.goto('/characters');
      const row = page.locator('.characters-list__item', { hasText: CHARACTER_NAME });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.locator('.characters-delete-confirm__title')).toBeVisible();
      await page.locator('.characters-delete-confirm__confirm').click();
      await expect(page.locator('.characters-list__item', { hasText: CHARACTER_NAME })).toHaveCount(
        0,
      );
    });

    await test.step('import the downloaded .hero file back in — the character returns', async () => {
      // `setInputFiles` directly on the (hidden) input, same as the portrait upload above — never
      // click the visible "Import" button first, which would call the real
      // `HTMLInputElement.click()` and pop a native OS file picker Playwright cannot drive
      // headlessly (a hang, not a failure it can recover from).
      await page.locator('.characters-list__import-input').setInputFiles(heroFilePath);
      const row = page.locator('.characters-list__item', { hasText: CHARACTER_NAME });
      await expect(row).toBeVisible();
      // A fresh `mode: 'created'` import (the row was fully deleted above, not merged) re-stores
      // the portrait blob by hash — the list thumb, not just the placeholder monogram, proves the
      // image round-tripped along with the events.
      await expect(row.locator('img.characters-list__portrait')).toBeVisible();
    });

    await test.step('name and HP are intact, and the sheet header shows the real portrait again', async () => {
      await page.locator('.characters-list__item', { hasText: CHARACTER_NAME }).click();
      await expect(page).toHaveURL(new RegExp(`/c/${characterId}/play$`));
      await expect(page.locator('.sheet-shell__name')).toHaveText(CHARACTER_NAME);
      await expect(page.locator('.sheet-shell__class-line')).toHaveText('Fighter 1');

      const hpSection = page.locator('.play-tab__hp-stats');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Current' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');
      await expect(
        hpSection.locator('hk-stat-tile', { hasText: 'Max' }).locator('.hk-stat-tile__value'),
      ).toHaveText('12');

      await expect(page.locator('img.sheet-shell__portrait')).toBeVisible();
    });
  });
});
