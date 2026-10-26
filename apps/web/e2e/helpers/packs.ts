import { expect, type Locator, type Page } from '@playwright/test';

/**
 * `/packs` → the hidden import input → the trust dialog, returned still open so the caller can
 * assert on it before installing. `setInputFiles` on the hidden input, never a click on the visible
 * Import button (that would pop a native picker headless Chromium cannot drive) — same as
 * `export-import.spec.ts`. Shared by `custom-packs.spec.ts` and `sync/campaign-packs.spec.ts`.
 */
export async function importPack(page: Page, file: string): Promise<Locator> {
  await page.goto('/packs');
  await expect(page.locator('.packs-list')).toBeVisible();
  await page.locator('.packs-list__import-input').setInputFiles(file);
  const dialog = page.locator('.pack-trust-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** An installed content pack's row on `/packs`, by its display name. */
export function installedPackRow(page: Page, packName: string): Locator {
  return page.locator('.packs-list__content .packs-list__row', { hasText: packName });
}
