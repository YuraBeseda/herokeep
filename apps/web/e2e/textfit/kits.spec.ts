import { expect, test } from '@playwright/test';
import {
  applyBackgroundAbilities,
  assignStandardArray,
  nameCharacter,
  pickBackground,
  pickClass,
  pickFightingStyleAndWeaponMasteries,
  pickGamingSet,
  pickSkills,
  pickSpecies,
} from '../helpers/create-fighter';
import { fitChecker } from './fit';

// The starting-equipment kit cards (Fighter + Soldier) on the wizard's equipment step, in real ru
// and uk. The wizard is driven in English (the helpers click English labels), then the language is
// switched live from the phone app menu, which keeps the draft.
test('starting equipment kit cards fit in ru and uk', async ({ page }, testInfo) => {
  // The live language switch is in the phone top-bar menu only; desktop has no in-wizard switch.
  test.skip(testInfo.project.name !== 'phone-360', 'no live language switch at desktop width');
  await nameCharacter(page, 'Aldric');
  await pickSpecies(page);
  await pickBackground(page);
  await applyBackgroundAbilities(page);
  await pickClass(page);
  await assignStandardArray(page);
  await pickSkills(page);
  await pickGamingSet(page);
  await pickFightingStyleAndWeaponMasteries(page);
  const cards = page.locator('.equipment-step__kits hk-picker-card');
  await expect(cards).toHaveCount(5);

  const { violations, check } = fitChecker(page);
  for (const [locale, bag] of [
    ['ru', 'Вариант A уже в сумке ниже'],
    ['uk', 'Варіант A уже в сумці нижче'],
  ] as const) {
    await check(`kit cards (${locale})`, async () => {
      await page.locator('.hk-topbar__folio').click();
      await page
        .locator('.hk-drawer__locale')
        .nth(locale === 'ru' ? 1 : 2)
        .click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.equipment-step__kits--class')).toContainText(bag);
      await expect(cards).toHaveCount(5);
    });
  }
  // Only the kit cards (and any step that threw) are in scope here; the rest of the equipment step has a known overflow, tracked separately.
  expect(violations.filter((v) => v.includes('hk-picker-card') || v.includes(': threw '))).toEqual(
    [],
  );
});
