import { expect, type Locator, type Page } from '@playwright/test';
import { confirmRecoveryCodesAndContinue, registerToCodesStep, uniqueUsername } from './helpers';
import { createFighter } from '../helpers/create-fighter';

/**
 * Shared plumbing for the plan-10 task-16 campaign e2e scenarios — the real-API, two/three-
 * browser-context tests under `campaign-*.spec.ts`. Builds directly on `./helpers.ts` (plan-8's
 * own auth/character helpers, reused unchanged) and `../helpers/create-fighter.ts` (the fighter-1
 * wizard walk), adding only the campaign-screen-specific plumbing task-16-brief.md's scenario list
 * needs: create/join/link, the lobby join code, the party/log tabs, DM tools, and campaign
 * settings. Every wait below is condition-tied (a real Playwright auto-retrying `expect`, or a
 * bounded poll loop that re-checks a real DOM condition on each iteration) — never a bare
 * `waitForTimeout` used as the END condition of a scenario, per the brief's stabilization
 * contract. Generous timeouts throughout mirror `./helpers.ts`'s own posture (cold starts, real
 * PBKDF2, real network) plus this plan's own known async budgets: the party-overview publisher's
 * >=5s debounce (`party-overview-publisher.service.ts`) and the edit-lock service's 15s poll
 * (`campaign-edit-lock.ts`'s `CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS`).
 */

/** Registers a brand-new account and creates a synced fighter (task-15-brief.md's binding
 * fighter-1 build) in one call — the common "a player with a real, server-synced character"
 * setup every scenario below needs at least once. Reloads and waits for the character's own sync
 * badge to read `'synced'` (mirrors `./helpers.ts`'s `auth.spec.ts` doc: the character must be a
 * real committed-to-the-server stream before campaign linking can treat it as eligible —
 * `LinkCharacterComponent.eligibility`'s own `'notSynced'` bucket gates on exactly this). Returns
 * the character's id (bare `char:` stream id) and name. */
export async function registerAndSyncFighter(
  page: Page,
  usernamePrefix: string,
  deviceLabel: string,
  characterName: string,
): Promise<{ readonly username: string; readonly characterId: string }> {
  const username = uniqueUsername(usernamePrefix);
  await registerToCodesStep(page, username, deviceLabel);
  await confirmRecoveryCodesAndContinue(page);
  const characterId = await createFighter(page, characterName);
  await page.reload();
  await page.goto('/characters');
  const badge = page
    .locator('.characters-list__item', { hasText: characterName })
    .locator('.characters-list__sync-badge');
  await expect(badge).toHaveAttribute('data-sync-state', 'synced', { timeout: 45_000 });
  return { username, characterId };
}

// --- Campaign create / join / link ---------------------------------------------------------

/** `/campaigns` -> "New campaign" -> confirm. Lands on `/g/<id>/lobby`; returns the bare
 * campaign id. */
export async function createCampaign(page: Page, name: string): Promise<string> {
  await page.goto('/campaigns');
  await page.locator('.campaigns-list__create').click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('.create-campaign-dialog__confirm').click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/lobby$/, { timeout: 20_000 });
  const match = /\/g\/([^/]+)\/lobby$/.exec(page.url());
  if (!match) throw new Error(`unexpected URL after campaign creation: ${page.url()}`);
  return match[1];
}

/** The DM's own lobby join code (`.lobby__code`, grouped `XXXX-XXXX` form, ruling 10). Waits for
 * it to render — the DM's own `CampaignsRepository` row (carrying the join code
 * `CampaignStore.create` cached at creation time) is a plain local Dexie read, but this still
 * polls rather than asserting instantly, since the lobby route itself needs to mount first. */
export async function readJoinCode(page: Page): Promise<string> {
  const code = page.locator('.lobby__code');
  await expect(code).toBeVisible({ timeout: 20_000 });
  const text = await code.textContent();
  if (!text) throw new Error('join code element rendered empty');
  return text.trim();
}

/** `/join` -> fill code + display name -> confirm. Lands on `/g/<id>/link-character` (ruling 4's
 * own next step, every join goes through it) — returns the bare campaign id. Passes the code
 * exactly as `readJoinCode` returned it (grouped, with its dash) — `JoinComponent`'s own doc: the
 * form "accepts sloppy input and lets the server normalize". */
export async function joinCampaign(page: Page, code: string, displayName: string): Promise<string> {
  await page.goto('/join');
  await page.locator('input[name="code"]').fill(code);
  await page.locator('input[name="displayName"]').fill(displayName);
  await page.locator('.join__confirm').click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/link-character$/, { timeout: 20_000 });
  const match = /\/g\/([^/]+)\/link-character$/.exec(page.url());
  if (!match) throw new Error(`unexpected URL after join: ${page.url()}`);
  return match[1];
}

function linkCharacterRow(page: Page, characterName: string): Locator {
  return page.locator('.link-character__row', { hasText: characterName });
}

/** Picks `characterName` on the already-open `/g/<id>/link-character` screen — requires
 * eligibility `'eligible'` (a synced, unlinked character; `LinkCharacterComponent.eligibility`) —
 * and completes the fresh two-step join sequence (ruling 4), landing on `/g/<id>/lobby`. Used both
 * for an ordinary member's own character AND for the DM's own pregen self-join (task-12-brief.md:
 * "structurally nothing but an ordinary DM-owned character joined to their own campaign").
 *
 * Asserts the URL transition alone, not `.link-character__success` — `LinkCharacterComponent
 * .select()` navigates to the lobby in the SAME tick `linkedOk()` first turns true (no render
 * pause in between), so the success paragraph is torn down again before Playwright can ever
 * observe it (confirmed the hard way: this helper's first version asserted it and timed out every
 * time, on an otherwise-successful join). The URL change IS the completed-sequence proof — nothing
 * else in this component reaches `/g/<id>/lobby` except that one branch. */
export async function linkCharacterByName(page: Page, characterName: string): Promise<void> {
  const row = linkCharacterRow(page, characterName);
  await expect(row).toHaveAttribute('data-eligibility', 'eligible', { timeout: 20_000 });
  await row.locator('.link-character__pick').click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/lobby$/, { timeout: 20_000 });
}

/** The "resume" completion (`retryCampaignLinkStepB` alone) — for a candidate already at
 * eligibility `'resume'`: a claimed pregen just pulled onto this device (this plan's own claim
 * path), or an interrupted earlier join. Same URL-transition proof as `linkCharacterByName` (see
 * its own doc for why `.link-character__success` can't be observed here either). */
export async function resumeLinkCharacterByName(page: Page, characterName: string): Promise<void> {
  const row = linkCharacterRow(page, characterName);
  await expect(row).toHaveAttribute('data-eligibility', 'resume', { timeout: 20_000 });
  await row.locator('.link-character__resume').click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/lobby$/, { timeout: 20_000 });
}

/** Skips character linking on the already-open `/g/<id>/link-character` screen, landing on
 * `/g/<id>/lobby` — for a bystander member with no character of their own in this campaign (this
 * plan's own `visibility.rolls`/`chat` "does a non-roller member see it" scenarios need a THIRD
 * party who is a real campaign member, not merely absent). */
export async function skipLinking(page: Page): Promise<void> {
  await page.locator('.link-character__skip').click();
  await expect(page).toHaveURL(/\/g\/[^/]+\/lobby$/);
}

/** Claims a DM-handed-over pregen (`claimedPregens`' own "Claim it"/"Try again" action, shared
 * class across every claim state) and polls until the row either disappears from the claimed
 * bucket (success — it now shows up in the ordinary candidates list as `'resume'`, per
 * `LinkCharacterComponent.claimPregen`'s own doc) or the deadline elapses. Each iteration is a
 * REAL click + a real DOM re-check (`data-claim-state`), never a blind sleep: the one genuinely
 * eventual-consistency gap here (`pullClaimedCharacter`'s `GET /api/characters` not yet reflecting
 * a handover that just committed server-side) is exactly what production's own "try again in a
 * moment" affordance exists for, so retrying through the SAME UI action is the honest way to
 * tolerate it, not a workaround. */
export async function claimPregenByName(
  page: Page,
  characterName: string,
  timeoutMs = 40_000,
): Promise<void> {
  const row = page.locator('.link-character__claimed-row', { hasText: characterName });
  await expect(row).toBeVisible({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // The action button is absent while a claim is in flight (`'pulling'` renders only a status
    // line, no button — `link-character.component.html`'s own `@switch`) — only click it when
    // it's actually there (idle / `'notYetVisible'` / `'failed'`), never blind.
    const actionButton = row.locator('.link-character__claimed-action');
    if (await actionButton.isVisible().catch(() => false)) {
      await actionButton.click();
    }
    const detached = await row
      .waitFor({ state: 'detached', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (detached) return;
    if (Date.now() >= deadline) {
      throw new Error(`claimPregenByName: '${characterName}' never left the claimed bucket`);
    }
  }
}

// --- Navigation shortcuts ---------------------------------------------------------------------

const TAB_LABEL: Record<'party' | 'log' | 'settings' | 'lobby', string> = {
  party: 'Party',
  log: 'Log',
  settings: 'Settings',
  lobby: 'Lobby',
};
const TAB_CONTENT_SELECTOR: Record<'party' | 'log' | 'settings' | 'lobby', string> = {
  party: '.party-tab',
  log: '.log-tab',
  settings: '.campaign-settings',
  lobby: '.lobby',
};

/** Enters `campaignId`'s campaign shell at `tab` — a client-side `hk-tabs` click
 * (`CampaignShellComponent.onTabSelected` -> `router.navigate`, a plain Angular route change,
 * NEVER a browser navigation) when the page is ALREADY somewhere under `/g/<campaignId>/...`, or
 * a real `page.goto` only for the first entry (or when the page is elsewhere entirely, e.g. a
 * character sheet). This matters for more than tidiness: a `page.goto` is a full browser
 * navigation that reboots the whole Angular app from scratch, tearing down and re-establishing
 * this device's `SyncService`/`StreamSyncSession`s — a real, observed source of flakiness for a
 * live-push assertion made shortly afterward (confirmed the hard way: an earlier version of this
 * helper always hard-navigated, and a live "everyone" chat push to a page that had JUST
 * hard-reloaded to reach the log tab never arrived within a generous 15s window — the WS
 * reconnect hadn't necessarily settled yet). Tab-clicking keeps the SAME already-live session
 * across every subsequent screen inside one campaign, exactly like a real player clicking
 * between tabs. */
async function gotoCampaignTab(
  page: Page,
  campaignId: string,
  tab: 'party' | 'log' | 'settings' | 'lobby',
): Promise<void> {
  if (page.url().includes(`/g/${campaignId}/`)) {
    await page.getByRole('tab', { name: TAB_LABEL[tab], exact: true }).click();
  } else {
    await page.goto(`/g/${campaignId}/${tab}`);
  }
  await expect(page.locator(TAB_CONTENT_SELECTOR[tab])).toBeVisible();
}

export async function gotoParty(page: Page, campaignId: string): Promise<void> {
  await gotoCampaignTab(page, campaignId, 'party');
}

export async function gotoLog(page: Page, campaignId: string): Promise<void> {
  await gotoCampaignTab(page, campaignId, 'log');
}

export async function gotoLobby(page: Page, campaignId: string): Promise<void> {
  await gotoCampaignTab(page, campaignId, 'lobby');
}

export async function gotoSettings(page: Page, campaignId: string): Promise<void> {
  await gotoCampaignTab(page, campaignId, 'settings');
}

// --- Party tab -------------------------------------------------------------------------------

export function partyCardByName(page: Page, characterName: string): Locator {
  return page.locator('.party-tab__card', { hasText: characterName });
}

/** Waits for `characterName`'s party card to show a resolved overview (`.party-tab__hp`) — i.e.
 * `PartyOverviewPublisherService`'s own debounced publish (>=5s after the owning device's last
 * committed local append, `PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS`) has landed and synced down to the
 * viewer. Generous timeout: the debounce window itself, plus cold-start/network margin. */
export async function waitForPartyOverview(page: Page, characterName: string): Promise<void> {
  await expect(partyCardByName(page, characterName).locator('.party-tab__hp')).toBeVisible({
    timeout: 25_000,
  });
}

/** Expands (if not already) `characterName`'s DM-effects panel and applies `amount` damage via
 * the FIRST hp row (Damage) — `DmEffectsPanelComponent.applyDamage`, routed through
 * `CampaignStore.gatewayAppend` onto the character's own stream. Waits for the panel's own inline
 * feedback (success — never the `--error` modifier) rather than assuming the click alone is
 * enough, since a rejected/failed gateway append must fail the test loudly, not silently. Caller
 * is responsible for having already awaited `waitForPartyOverview` for this card (damage is
 * disabled with no HP baseline — `canApplyHp()`). */
export async function applyPartyCardDamage(
  page: Page,
  characterName: string,
  amount: number,
): Promise<void> {
  const card = partyCardByName(page, characterName);
  const toggle = card.locator('.dm-effects-panel__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const hpRow = card.locator('.dm-effects-panel__hp-row').first();
  await hpRow.locator('.hk-number-field__input').fill(String(amount));
  await hpRow.getByRole('button', { name: 'Damage', exact: true }).click();
  const feedback = card.locator('.dm-effects-panel__feedback');
  await expect(feedback).toBeVisible({ timeout: 15_000 });
  await expect(feedback).not.toHaveClass(/dm-effects-panel__feedback--error/);
}

// --- Log tab (rolls, chat, sessions) ------------------------------------------------------------

export function logRollEntries(page: Page): Locator {
  return page.locator('.log-tab__entry--roll');
}

export function logChatEntries(page: Page): Locator {
  return page.locator('.log-tab__entry--chat');
}

/** Sends a chat message from the already-open `/g/<id>/log` screen at the given visibility
 * (default `'everyone'`, the composer's own live default — `LogTabComponent.resetDefaultVisibility`).
 * `campaigns.log.composer.visibility.<v>` label text picks the toggle button. */
export async function sendChat(
  page: Page,
  text: string,
  visibility: 'everyone' | 'dm' | 'private' = 'everyone',
): Promise<void> {
  const label =
    visibility === 'everyone' ? 'Everyone' : visibility === 'dm' ? 'DM only' : 'Private';
  const group = page.locator('.log-tab__composer-visibility');
  const button = group.getByRole('button', { name: label, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click();
  }
  await page.locator('#log-tab-composer-text').fill(text);
  await page.locator('.log-tab__composer-send').click();
}

export async function startSession(page: Page, title?: string): Promise<void> {
  if (title) {
    await page.locator('#log-tab-session-title').fill(title);
  }
  await page.locator('.log-tab__session-start-submit').click();
  await expect(page.locator('.log-tab__session-end')).toBeVisible({ timeout: 15_000 });
}

export async function endSession(page: Page): Promise<void> {
  await page.locator('.log-tab__session-end').click();
  await expect(page.locator('.log-tab__session-start-submit')).toBeVisible({ timeout: 15_000 });
}

// --- Play tab: campaign-aware roll publishing --------------------------------------------------

/** Sets the (sticky) campaign roll-visibility picker on the character's OWN already-open play
 * tab (`RollLogPanelComponent`'s `.roll-log-panel__visibility` group) — only rendered once
 * `PlayTabComponent.campaignRollStreamId()` resolves (the character is campaign-linked AND that
 * campaign's own sync isn't `'offline'`), so this waits for the picker itself to appear first. */
export async function setCampaignRollVisibility(
  page: Page,
  visibility: 'everyone' | 'dm' | 'private',
): Promise<void> {
  const label =
    visibility === 'everyone' ? 'Everyone' : visibility === 'dm' ? 'DM only' : 'Private';
  const group = page.locator('.roll-log-panel__visibility');
  await expect(group).toBeVisible({ timeout: 25_000 });
  await group.getByRole('button', { name: label, exact: true }).click();
}

/** Rolls the FIRST ability card's "Roll check" button (`PlayTabComponent.onRollAbilityCheck` ->
 * `performD20Roll` -> `publishRoll`) — a real d20 roll, published onto the campaign stream at
 * whatever `setCampaignRollVisibility` last set (default `'everyone'`, ruling 5). */
export async function rollFirstAbilityCheck(page: Page): Promise<void> {
  const card = page.locator('.play-tab__ability-grid hk-card').first();
  await card.getByRole('button', { name: 'Roll check', exact: true }).click();
}

// --- Lobby: members, removal --------------------------------------------------------------------

export function lobbyMemberRow(page: Page, displayName: string): Locator {
  return page.locator('.lobby__member-row', { hasText: displayName });
}

/** DM removes `displayName` from the lobby's member list (confirm dialog included) — the server
 * appends `member.removed` and byes that member's own live sockets (task-6-brief.md's binding
 * carry, `SyncService.handleCampaignBye`).
 *
 * `LobbyRemoveMemberConfirmComponent` (`lobby.component.ts`'s own one-off content component) gives
 * its title/body/actions ROW a class each but NOT its two buttons individually — unlike the
 * unlink/handover dialogs' own `__confirm`/`__cancel` convention, both its buttons are plain
 * `hk-button`s with only i18n text ("Cancel"/"Remove"). Its confirm button's OWN text ("Remove")
 * collides with the lobby row's still-present "Remove" button underneath the dialog overlay, so
 * this scopes to `.lobby-remove-member-confirm__actions` specifically rather than a bare
 * text/role lookup — confirmed the hard way: an earlier version of this helper guessed at a
 * `.lobby-remove-member-confirm__confirm` class that doesn't exist and hung for the whole test
 * timeout waiting on it.
 *
 * A removed member's row is NEVER hidden (`lobby.component.html`'s own template: `member.removed`
 * only adds a badge and drops the row's `canRemove`-gated Remove button — doc-03's roster stays
 * a full audit trail, never a live-only view), so this waits for the `.lobby__member-removed-
 * badge` to appear on the SAME row rather than for the row itself to vanish. */
export async function removeMember(page: Page, displayName: string): Promise<void> {
  const row = lobbyMemberRow(page, displayName);
  await row.locator('.lobby__member-remove').click();
  await page
    .locator('.lobby-remove-member-confirm__actions')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(row.locator('.lobby__member-removed-badge')).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.lobby__member-remove')).toHaveCount(0);
}

// --- Party tab: pregen / handover / unlink --------------------------------------------------

export async function addPregen(page: Page): Promise<void> {
  await page.locator('.party-tab__add-pregen').click();
  await expect(page).toHaveURL(/\/characters\/new\?returnUrl=/);
}

export async function openHandoverDialog(page: Page, characterName: string): Promise<void> {
  const card = partyCardByName(page, characterName);
  await card.locator('.party-tab__handover').click();
  await expect(page.locator('.handover-character-dialog__title')).toBeVisible();
}

/** Completes the handover dialog (already open, `openHandoverDialog`) to `memberDisplayName` —
 * the real 5-step sequence ending in `POST /api/characters/:id/transfer` (R-T12).
 *
 * Same transient-success-text pitfall as `linkCharacterByName`'s/`unlinkCharacter`'s own doc:
 * `HandoverCharacterDialogComponent.run()` closes the dialog (`dialogRef.close(true)`) in the SAME
 * tick `handedOverOk()` turns true, so `.handover-character-dialog__success` is never actually
 * observable — this waits for the dialog itself to close (its title unmounting) instead. The
 * caller is responsible for asserting the real effect (the DM's own party card losing its
 * `.party-tab__handover` button for this now-reassigned pregen). */
export async function confirmHandoverTo(page: Page, memberDisplayName: string): Promise<void> {
  await page.locator('.handover-character-dialog__member', { hasText: memberDisplayName }).click();
  await page.locator('.handover-character-dialog__confirm').click();
  await expect(page.locator('.handover-character-dialog__title')).toHaveCount(0, {
    timeout: 30_000,
  });
}

/** Same transient-success-text pitfall as `linkCharacterByName`'s own doc:
 * `UnlinkCharacterDialogComponent.run()` closes the dialog (`dialogRef.close(true)`) in the SAME
 * tick `unlinkedOk()` turns true, so `.unlink-character-dialog__success` is never observable here
 * either — this waits for the dialog itself to close (its title unmounting) instead. The caller
 * is responsible for asserting the actual effect (the roster card's `.party-tab__unlink` button
 * disappearing, since `canUnlink` no longer holds for an already-unlinked entry). */
export async function unlinkCharacter(page: Page, characterName: string): Promise<void> {
  const card = partyCardByName(page, characterName);
  await card.locator('.party-tab__unlink').click();
  await expect(page.locator('.unlink-character-dialog__title')).toBeVisible();
  await page.locator('.unlink-character-dialog__confirm').click();
  await expect(page.locator('.unlink-character-dialog__title')).toHaveCount(0, {
    timeout: 20_000,
  });
}

// --- Campaign settings: house rules --------------------------------------------------------------

/** Sets `houseRules.editOutsideSession` (ruling 7) via the settings chip row and saves — the DM
 * must already be on `/g/<id>/settings` and be the write-leader (`canEdit()`). */
export async function setEditOutsideSession(
  page: Page,
  value: 'free' | 'dmApproval' | 'locked',
): Promise<void> {
  const label = value === 'free' ? 'Free' : value === 'dmApproval' ? 'Needs DM approval' : 'Locked';
  const field = page
    .locator('.campaign-settings__field')
    .filter({ hasText: 'Editing outside a session' });
  const chip = field.getByRole('button', { name: label, exact: true });
  await chip.click();
  await page.locator('.campaign-settings__save').click();
  // `save()` resets the form's local `draft` back to `null` once the append settles, so `current()`
  // falls through to `effective()` (the just-committed, already-locally-applied document) — the
  // chip staying selected (rather than reverting to whatever it showed before this call) is what
  // actually proves the save round-tripped, not just that the button re-enabled.
  await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
}
