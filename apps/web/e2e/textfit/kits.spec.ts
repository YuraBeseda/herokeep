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
import { createFighter } from '../helpers/create-fighter';
import { bagRow } from '../helpers/sheet';
import { isPhone } from '../helpers/viewport';
import { fitChecker, installFitLocale } from './fit';

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
    ['ru', 'Р’Р°СЂРёР°РЅС‚ A СѓР¶Рµ РІ СЃСѓРјРєРµ РЅРёР¶Рµ'],
    ['uk', 'Р’Р°СЂС–Р°РЅС‚ A СѓР¶Рµ РІ СЃСѓРјС†С– РЅРёР¶С‡Рµ'],
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
  expect(violations).toEqual([]);
});

// The bag row's context menu (labels, hints, disabled reasons) in the `fit` locale at this width.
test('the bag row context menu fits', async ({ page }) => {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await createFighter(page, 'Aldric Menu Fit');
  await page.setViewportSize(viewport);
  await installFitLocale(page);
  await page.goto(`/c/${id}/${isPhone(page) ? 'bag' : 'play'}`);

  const { violations, check } = fitChecker(page);
  await check('bag row menu', async () => {
    // The phone route already is the Bag tab (its tab label is in the fit locale, so no tab click).
    const row = isPhone(page)
      ? page
          .locator('.bag__ledger li')
          .filter({ hasText: "Healer's Kit" })
          .locator('.hk-item__select')
      : await bagRow(page, "Healer's Kit");
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
  });
  expect(violations).toEqual([]);
});
