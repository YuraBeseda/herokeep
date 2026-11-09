import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoSeriousViolations } from '../helpers/axe';
import { importPack, installedPackRow } from '../helpers/packs';
import { addFromLibrary, bagSlot, openTab, searchLibrary } from '../helpers/sheet';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  gotoParty,
  gotoSettings,
  joinCampaign,
  linkCharacterByName,
  partyCardByName,
  readJoinCode,
  registerAndSyncFighter,
  setPartySheets,
} from './campaign-helpers';

/**
 * Plan 16 (Phase 4 slice 6) task 8: the campaign pack relay end to end, two real browser contexts
 * against the real Node API adapter.
 *
 * The DM imports `sample-content.hkpack` (the plan-15 fixture), creates a campaign and enables the
 * pack in the campaign settings' Content packs section: the client PUTs the canonical pack JSON
 * and appends `pack.enabled@1`, which the campaign actor accepts only once that body is stored. A
 * member joins and, with no pack file of their own, gets it installed automatically: the device
 * GETs the body, validates it like a `.hero` pack and installs it. The member links a fighter;
 * its sheet offers "Pin campaign packs", and pinning puts the pack into the character's content
 * index. The DM's party view then derives that member's sheet against the member's own pins. When
 * the DM disables the pack, the member's settings section follows live, and the character keeps
 * its pin (pins are never forced either way).
 *
 * The evidence of pack resolution on the member's sheet is the pack's WEAPON (Moonblade Sickle),
 * not its species (controller ruling, plan 16 task 8): a species is a creation-time decision that a
 * sheet never re-opens once made, so an already-linked character cannot take the pack's species.
 * The weapon is searched in the character's own library before and after the pin (absent, then
 * present), and it is what the DM's member-sheet drawer names through the member's pins.
 *
 * The DM saves "Full sheets" first: the party card's "View sheet" drill-in needs
 * `partySheets: 'full'`, and the web client reads never-saved settings as `'overview'`.
 */

const SAMPLE_HKPACK = path.join(__dirname, '..', 'fixtures', 'packs', 'sample-content.hkpack');
const PACK_ID = 'sample-content';
const PACK_NAME = 'Sample content';
const PACK_WEAPON = 'Moonblade Sickle';
const CHARACTER_NAME = 'Aldric Packs Member';

/** A pack's row in the campaign settings' Content packs section (DM or member view). */
function campaignPackRow(page: Page): Locator {
  return page.locator(`.campaign-packs__row[data-pack-id="${PACK_ID}"]`);
}

test.describe('campaign: content pack relay', () => {
  test('DM enables a pack; a member auto-installs it, pins it from the sheet banner; the DM view uses the member pins; disable follows live', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);

    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and import sample-content.hkpack through the trust screen', async () => {
      await registerToCodesStep(page, uniqueUsername('dmpacks'), 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      const dialog = await importPack(page, SAMPLE_HKPACK);
      await expect(dialog.locator('.pack-trust-dialog__title')).toHaveText(`Install ${PACK_NAME}?`);
      await dialog.locator('.pack-trust-dialog__install').click();
      await expect(dialog).toHaveCount(0);
      await expect(installedPackRow(page, PACK_NAME)).toContainText('1.0.0');
    });

    await test.step('DM: create the campaign and enable the pack in its settings', async () => {
      campaignId = await createCampaign(page, 'Pack Relay Campaign');
      joinCode = await readJoinCode(page);
      await gotoSettings(page, campaignId);
      // Full party sheets: the DM's "View sheet" drill-in at the end of this flow needs it.
      await setPartySheets(page, 'full');

      const quota = page.locator('.campaign-packs__quota');
      const row = campaignPackRow(page);
      await expect(page.locator('.campaign-packs .hk-leaf__title-text')).toHaveText(
        'Content packs',
      );
      await expect(quota).toHaveText('0 / 6 packs enabled');
      await expect(row.locator('.campaign-packs__name')).toHaveText(PACK_NAME);
      await expect(row.locator('.campaign-packs__version')).toHaveText('Version 1.0.0');

      await row.getByRole('button', { name: 'Enable', exact: true }).click();
      // The row only flips once the upload is stored and `pack.enabled@1` is folded locally.
      await expect(row.locator('.campaign-packs__version')).toHaveText(
        'Enabled for the campaign: version 1.0.0',
        { timeout: 20_000 },
      );
      await expect(quota).toHaveText('1 / 6 packs enabled');
      await expect(row.getByRole('button', { name: 'Disable', exact: true })).toBeEnabled();
      await expect(row.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(0);
    });

    await test.step('axe: the campaign settings screen with its Content packs section', async () => {
      await assertNoSeriousViolations(page, 'campaign settings — content packs (DM)');
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      let characterId = '';

      await test.step('member: register and sync a fighter (core content only)', async () => {
        const result = await registerAndSyncFighter(
          memberPage,
          'mempacks',
          'Member Device',
          CHARACTER_NAME,
        );
        characterId = result.characterId;
      });

      await test.step('member: join by code; the enabled pack installs itself on this device', async () => {
        const joinedCampaignId = await joinCampaign(memberPage, joinCode, 'Pack Player');
        expect(joinedCampaignId).toBe(campaignId);
        // This device never saw a pack file: the row can only come from the campaign's copy.
        await memberPage.goto('/packs');
        await expect(installedPackRow(memberPage, PACK_NAME)).toContainText('1.0.0', {
          timeout: 30_000,
        });
      });

      await test.step('member: link the fighter to the campaign', async () => {
        await memberPage.goto(`/g/${campaignId}/link-character`);
        await linkCharacterByName(memberPage, CHARACTER_NAME);
      });

      await test.step("member sheet: the banner offers the campaign's pack, which the character does not use yet", async () => {
        await memberPage.goto(`/c/${characterId}/play`);
        const banner = memberPage.locator('.campaign-packs-banner');
        await expect(banner).toBeVisible({ timeout: 30_000 });
        await expect(banner).toContainText(`${PACK_NAME} v1.0.0`);
        await expect(banner.locator('.campaign-packs-banner__pin')).toBeEnabled();

        const dialog = await searchLibrary(memberPage, 'Moonblade');
        await expect(dialog.locator('.entity-picker__empty')).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(memberPage.locator('.add-item-dialog__title')).toHaveCount(0);
      });

      await test.step('member sheet: Pin campaign packs pins the pack and the banner goes away', async () => {
        await memberPage.locator('.campaign-packs-banner__pin').click();
        await expect(memberPage.locator('.campaign-packs-banner')).toHaveCount(0, {
          timeout: 15_000,
        });
        await openTab(memberPage, 'Build');
        await expect(
          memberPage.locator(
            `.build-packs__row[data-pack-id="${PACK_ID}"] .build-packs__toggle button[role="switch"]`,
          ),
        ).toHaveAttribute('aria-checked', 'true');
        await openTab(memberPage, 'Timeline');
        await expect(memberPage.locator('.timeline-tab')).toContainText(
          `Pinned ${PACK_NAME} v1.0.0.`,
        );
      });

      await test.step("member sheet: the pack's weapon is now in the character's library", async () => {
        await openTab(memberPage, 'Play');
        await addFromLibrary(memberPage, 'Moonblade', PACK_WEAPON);
        await expect(bagSlot(memberPage, PACK_WEAPON)).toBeVisible();
      });

      await test.step("DM party view: the member's sheet derives with the member's pins", async () => {
        await gotoParty(page, campaignId);
        const card = partyCardByName(page, CHARACTER_NAME);
        await expect(card).toBeVisible({ timeout: 25_000 });
        await card.locator('.party-tab__view-sheet, .hk-party__open').first().click();
        const dialog = page.locator('app-member-sheet-drawer [role="dialog"]');
        await expect(dialog).toBeVisible();
        // Resolved through the member's index: under the core-only index this row is the raw
        // `sample-content:item/moonblade-sickle` id.
        await expect(dialog.locator('.msd__inventory')).toContainText(`${PACK_WEAPON} × 1`, {
          timeout: 30_000,
        });
        await expect(dialog.locator('.msd__missing-packs')).toHaveCount(0);
        await dialog.locator('.hk-drawer__head button').click();
        await expect(dialog).toHaveCount(0);
      });

      await test.step('member: the campaign settings list the pack as installed', async () => {
        await gotoSettings(memberPage, campaignId);
        const row = campaignPackRow(memberPage);
        await expect(row.locator('.campaign-packs__version')).toHaveText('Version 1.0.0');
        await expect(row.locator('.campaign-packs__status')).toHaveText('Installed');
        await expect(memberPage.locator('.campaign-packs__quota')).toHaveCount(0);
      });

      await test.step('DM: disable the pack', async () => {
        await gotoSettings(page, campaignId);
        const row = campaignPackRow(page);
        await row.getByRole('button', { name: 'Disable', exact: true }).click();
        await expect(page.locator('.campaign-packs__quota')).toHaveText('0 / 6 packs enabled', {
          timeout: 20_000,
        });
        await expect(row.locator('.campaign-packs__version')).toHaveText('Version 1.0.0');
        await expect(row.getByRole('button', { name: 'Enable', exact: true })).toBeEnabled();
      });

      await test.step('member: the settings follow live; the character keeps its pin and the device keeps the pack', async () => {
        // No navigation on the member's page: only the live campaign stream can empty the list.
        await expect(memberPage.locator('.campaign-packs__empty')).toHaveText(
          'This campaign has no content packs enabled.',
          { timeout: 20_000 },
        );
        await expect(campaignPackRow(memberPage)).toHaveCount(0);

        await memberPage.goto(`/c/${characterId}/build`);
        await expect(
          memberPage.locator(
            `.build-packs__row[data-pack-id="${PACK_ID}"] .build-packs__toggle button[role="switch"]`,
          ),
        ).toHaveAttribute('aria-checked', 'true');
        await expect(memberPage.locator('.campaign-packs-banner')).toHaveCount(0);
        await memberPage.goto('/packs');
        await expect(installedPackRow(memberPage, PACK_NAME)).toContainText('1.0.0');
      });
    } finally {
      await memberContext.close();
    }
  });
});
