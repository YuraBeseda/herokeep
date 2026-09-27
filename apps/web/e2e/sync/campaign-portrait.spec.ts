import path from 'node:path';
import { expect, test } from '@playwright/test';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  gotoParty,
  joinCampaign,
  linkCharacterByName,
  partyCardByName,
  readJoinCode,
  registerAndSyncFighter,
  waitForPartyOverview,
} from './campaign-helpers';

const PORTRAIT_FIXTURE = path.join(__dirname, '..', 'fixtures', 'tiny-portrait.png');

/**
 * Plan-10 task-16-brief.md's T13 carry (mandatory, not optional): a member sets a portrait on
 * their own campaign-linked character, and the DM — who never received those bytes directly —
 * sees the real thumbnail render on the party card. This can only happen through the campaign's
 * blob relay (`BlobTransferService`'s announce/request/serve protocol, task-13-brief.md) with the
 * DM's own connection acting as super-peer: the DM's device never uploaded or was sent this file
 * out of band, so an `img.party-tab__portrait` (as opposed to the monogram placeholder,
 * `.party-tab__portrait--placeholder`) appearing there is only explainable by the relay actually
 * having pulled the bytes across.
 */
test.describe('campaign: portrait relay', () => {
  test("a member's portrait relays to the DM's party card via the campaign's super-peer blob transfer", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    const campaignName = 'Portrait Campaign';
    const characterName = 'Aldric Portrait';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and create the campaign', async () => {
      const dmUsername = uniqueUsername('dmportrait');
      await registerToCodesStep(page, dmUsername, 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, campaignName);
      joinCode = await readJoinCode(page);
    });

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      let characterId = '';

      await test.step('member: register, create + sync a fighter', async () => {
        const result = await registerAndSyncFighter(
          memberPage,
          'memportrait',
          'Member Device',
          characterName,
        );
        characterId = result.characterId;
      });

      await test.step('member: uploads a real portrait via the Build tab (real image pipeline)', async () => {
        await memberPage.goto(`/c/${characterId}/build`);
        await memberPage.locator('.build-tab__portrait-input').setInputFiles(PORTRAIT_FIXTURE);
        await expect(memberPage.locator('img.build-tab__portrait-preview')).toBeVisible();
      });

      await test.step("settle: the CharactersRepository row's own portraitThumbHash is what BlobTransferService's connect-time P1 announce reads (NOT live CharacterStore.facts()) — wait for the /characters list row's own thumb before joining, so the announce has real data to work with", async () => {
        await memberPage.goto('/characters');
        const row = memberPage.locator('.characters-list__item', { hasText: characterName });
        await expect(row.locator('img.characters-list__portrait')).toBeVisible({ timeout: 15_000 });
      });

      await test.step('member: joins the campaign and links this (now-portraited) character', async () => {
        const joinedCampaignId = await joinCampaign(memberPage, joinCode, 'Portrait Player');
        expect(joinedCampaignId).toBe(campaignId);
        await linkCharacterByName(memberPage, characterName);
      });

      await test.step('DM: the party overview lands, then the real portrait relays in and renders', async () => {
        await gotoParty(page, campaignId);
        await waitForPartyOverview(page, characterName);

        const card = partyCardByName(page, characterName);
        // Placeholder monogram until the blob relay completes — the thumb replacing it is the
        // proof the DM's super-peer connection actually pulled the bytes from the member's device.
        await expect(card.locator('img.party-tab__portrait')).toBeVisible({ timeout: 45_000 });
        await expect(card.locator('.party-tab__portrait--placeholder')).toHaveCount(0);
      });
    } finally {
      await memberContext.close();
    }
  });
});
