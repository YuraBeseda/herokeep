import { expect, test } from '@playwright/test';
import { fitChecker, installFitLocale } from '../textfit/fit';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import {
  createCampaign,
  joinCampaign,
  linkCharacterByName,
  readJoinCode,
  registerAndSyncFighter,
  selectPartyCard,
  startSession,
  waitForPartyOverview,
} from './campaign-helpers';

// The campaign screens (behind the auth guard, so not reachable by the offline textfit project), at
// both text-fit widths with the `fit` locale (`../textfit/fit.ts`), as the DM and as a player.
// Seeded in English at the project's desktop viewport; the fit locale is installed afterwards.
const WIDTHS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
];

test('campaign screens fit at phone and desktop widths, DM and player', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const memberName = 'Aldric Fit Member';
  const dm = fitChecker(page);

  await registerToCodesStep(page, uniqueUsername('dmfit'), 'DM Device');
  await confirmRecoveryCodesAndContinue(page);
  const campaignId = await createCampaign(page, 'Fit Campaign');
  const joinCode = await readJoinCode(page);

  const memberContext = await browser.newContext();
  try {
    const member = await memberContext.newPage();
    const player = fitChecker(member);
    await registerAndSyncFighter(member, 'membfit', 'Member Device', memberName);
    await joinCampaign(member, joinCode, 'Pip The Long Named Player');
    await linkCharacterByName(member, memberName);

    // The DM's party view, with a card picked (quick effects) and a session running in the log.
    await page.goto(`/g/${campaignId}/party`);
    await waitForPartyOverview(page, memberName);
    await page.goto(`/g/${campaignId}/log`);
    await startSession(page, 'The Very Long Session Title');

    await installFitLocale(page);
    await installFitLocale(member);

    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      await member.setViewportSize(size);
      await dm.visit('/campaigns');
      for (const tab of ['lobby', 'log', 'settings']) {
        await dm.visit(`/g/${campaignId}/${tab}`);
      }
      await dm.check('/g/party (DM, card picked)', async () => {
        await page.goto(`/g/${campaignId}/party`);
        await waitForPartyOverview(page, memberName);
        await selectPartyCard(page, memberName);
      });

      for (const path of ['/campaigns', '/join', `/join/${joinCode}`]) await player.visit(path);
      for (const tab of ['lobby', 'party', 'log', 'settings', 'link-character']) {
        await player.visit(`/g/${campaignId}/${tab}`);
      }
    }

    const all = [...dm.violations, ...player.violations];
    expect(all, all.join('\n')).toEqual([]);
  } finally {
    await memberContext.close();
  }
});
