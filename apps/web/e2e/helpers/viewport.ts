import { expect, type Page } from '@playwright/test';

/** Below this width the sheet is the phone layout (`PHONE_QUERY` in `ui/shell/viewport.ts`). */
const PHONE_MAX_WIDTH = 768;

/** Whether the page is at a phone width, so a helper drives the bottom tabs instead of the folio's. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? Infinity) < PHONE_MAX_WIDTH;
}

/** Where the sheet lands after creation or a level-up: the Play tab, or a phone tab of it. */
export const SHEET_HOME = /\/c\/[^/]+\/(play|combat|spells|bag|hero|more)$/;

/** Opens a phone tab from the bottom tab bar (names are the shell scope's tab labels). */
export async function openPhoneTab(
  page: Page,
  tab: 'Combat' | 'Spells' | 'Bag' | 'Hero' | 'More',
): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Sections of this screen' })
    .getByRole('link', { name: tab, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/c/[^/]+/${tab.toLowerCase()}$`));
}
