import { expect, test } from '@playwright/test';
import { registerAndContinue, TEST_PASSWORD, uniqueUsername } from './helpers';

test('settings: new recovery codes replace the old ones and one of them resets the password', async ({
  page,
}) => {
  const username = uniqueUsername('regen');
  const oldCodes = await registerAndContinue(page, username, 'Regen device');

  const newCodes = await test.step('regenerate from Settings with the password', async () => {
    await page.goto('/settings');
    await page.locator('.settings__recovery-codes').click();
    const dialog = page.locator('.recovery-codes-dialog__form');
    await dialog.locator('input[name="password"]').fill(TEST_PASSWORD);
    await dialog.locator('.recovery-codes-dialog__submit').click();
    await expect(page.locator('.recovery-codes__code')).toHaveCount(6);
    const codes = await page.locator('.recovery-codes__code').allTextContents();
    expect(codes.some((c) => oldCodes.includes(c))).toBe(false);
    await page.locator('.recovery-codes-dialog__done').click();
    return codes;
  });

  await test.step('sign out, then reset the password with a new code', async () => {
    await page.locator('.settings__logout').click();
    await page.goto('/recover');
    await page.locator('.recover__form input[name="username"]').fill(username);
    await page.locator('.recover__form input[name="code"]').fill(newCodes[0]);
    await page.locator('.recover__form input[name="newPassword"]').fill('Tn4!Gld-Resolved88qW');
    await page.locator('.recover__submit').click();
    await expect(page).toHaveURL(/\/characters$/);
  });
});
