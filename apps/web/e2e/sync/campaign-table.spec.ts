import { expect, test } from '@playwright/test';
import {
  confirmRecoveryCodesAndContinue,
  hpValueLocator,
  registerToCodesStep,
  uniqueUsername,
} from './helpers';
import {
  applyPartyCardDamage,
  createCampaign,
  gotoLobby,
  gotoLog,
  gotoParty,
  joinCampaign,
  linkCharacterByName,
  logChatEntries,
  logRollEntries,
  readJoinCode,
  registerAndSyncFighter,
  removeMember,
  rollFirstAbilityCheck,
  sendChat,
  setCampaignRollVisibility,
  skipLinking,
  unlinkCharacter,
  waitForPartyOverview,
} from './campaign-helpers';

/**
 * Plan-10 task-16-brief.md — the core campaign table flow, three real browser contexts against
 * the real Node API adapter (DM, a member with a synced character, and a bystander second
 * member): create -> join by code with a synced character -> party overview on the DM side ->
 * dm-visibility roll routing (the DM sees it, the non-roller second member's own socket never
 * even receives it — doc-08 server-side filtering, not client-side hiding) -> chat at
 * `'everyone'` visibility (both members see it) -> a DM-applied damage effect lands live on the
 * owning member's own open sheet (no reload) -> a lobby removal byes the removed member's
 * campaign UI (client-side navigation away from `/g/:id/...`) -> the DM unlinks the
 * now-ownerless roster entry. The pregen/handover/claim path and the portrait relay each get
 * their own dedicated spec file (`campaign-claim.spec.ts`, `campaign-portrait.spec.ts`) — this
 * file stays focused on the ordinary member lifecycle.
 */
test.describe('campaign: core table flow', () => {
  test('create, join, party overview, dm-visibility roll routing, chat, DM damage, removal bye, unlink', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);

    const campaignName = 'Table Flow Campaign';
    const memberCharacterName = 'Aldric Table Member';
    let campaignId = '';
    let joinCode = '';

    await test.step('DM: register and create the campaign', async () => {
      const dmUsername = uniqueUsername('dmtable');
      await registerToCodesStep(page, dmUsername, 'DM Device');
      await confirmRecoveryCodesAndContinue(page);
      campaignId = await createCampaign(page, campaignName);
      joinCode = await readJoinCode(page);
      expect(joinCode.length).toBeGreaterThan(0);
    });

    const memberContext = await browser.newContext();
    const secondContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      const secondPage = await secondContext.newPage();

      let memberCharacterId = '';
      await test.step('member: register, create + sync a fighter, join by code, link it', async () => {
        const result = await registerAndSyncFighter(
          memberPage,
          'membtable',
          'Member Device',
          memberCharacterName,
        );
        memberCharacterId = result.characterId;
        const joinedCampaignId = await joinCampaign(memberPage, joinCode, 'Member One');
        expect(joinedCampaignId).toBe(campaignId);
        await linkCharacterByName(memberPage, memberCharacterName);
      });

      await test.step("DM: the party tab shows the member's resolved overview", async () => {
        await gotoParty(page, campaignId);
        await waitForPartyOverview(page, memberCharacterName);
      });

      await test.step('second member: register and join by code as a bystander (no character)', async () => {
        const secondUsername = uniqueUsername('secondtable');
        await registerToCodesStep(secondPage, secondUsername, 'Second Device');
        await confirmRecoveryCodesAndContinue(secondPage);
        const joinedCampaignId = await joinCampaign(secondPage, joinCode, 'Member Two');
        expect(joinedCampaignId).toBe(campaignId);
        await skipLinking(secondPage);
      });

      await test.step('member: rolls an ability check at DM-only visibility from their own sheet', async () => {
        await memberPage.goto(`/c/${memberCharacterId}/play`);
        await setCampaignRollVisibility(memberPage, 'dm');
        await rollFirstAbilityCheck(memberPage);
      });

      await test.step('DM sees the dm-visibility roll in the campaign log', async () => {
        await gotoLog(page, campaignId);
        await expect(logRollEntries(page)).toHaveCount(1, { timeout: 25_000 });
      });

      await test.step('the second member (not DM, not the roller) never receives it', async () => {
        await gotoLog(secondPage, campaignId);
        await expect(logRollEntries(secondPage)).toHaveCount(0);
      });

      await test.step('DM sends an everyone-visible chat message; both members see it', async () => {
        // Already on the log tab from the previous step.
        await sendChat(page, 'Welcome to the table.', 'everyone');
        await expect(logChatEntries(page)).toHaveCount(1, { timeout: 15_000 });

        await expect(logChatEntries(secondPage)).toHaveCount(1, { timeout: 15_000 });
        await expect(secondPage.locator('.log-tab__entry--chat .log-tab__entry-text')).toHaveText(
          'Welcome to the table.',
        );

        await gotoLog(memberPage, campaignId);
        await expect(logChatEntries(memberPage)).toHaveCount(1, { timeout: 15_000 });
      });

      await test.step("DM applies damage from the party card; it lands live on the member's own open sheet", async () => {
        await memberPage.goto(`/c/${memberCharacterId}/play`);
        await expect(hpValueLocator(memberPage, 'Current')).toHaveText('12');

        await gotoParty(page, campaignId);
        await applyPartyCardDamage(page, memberCharacterName, 5);

        // No reload/navigation in memberPage anywhere in this step — only the character's own
        // live `StreamSyncSession` push (the server-side gateway forward landing on the owning
        // device's real-time socket) can make this pass.
        await expect(hpValueLocator(memberPage, 'Current')).toHaveText('7', { timeout: 20_000 });
      });

      await test.step('the member navigates back into the campaign UI before the DM removes them', async () => {
        await gotoParty(memberPage, campaignId);
      });

      await test.step('DM removes the member from the lobby', async () => {
        await gotoLobby(page, campaignId);
        await removeMember(page, 'Member One');
      });

      await test.step("the removal bye closes the member's campaign UI", async () => {
        await expect(memberPage).toHaveURL(/\/campaigns$/, { timeout: 20_000 });
      });

      await test.step('DM unlinks the now-ownerless character from the roster', async () => {
        await gotoParty(page, campaignId);
        await unlinkCharacter(page, memberCharacterName);
        await expect(page.locator('.party-tab__unlink')).toHaveCount(0);
      });
    } finally {
      await memberContext.close();
      await secondContext.close();
    }
  });
});
