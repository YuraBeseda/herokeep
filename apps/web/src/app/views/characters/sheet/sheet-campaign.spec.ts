import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CampaignSettings } from '@hk/protocol';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { routes } from '../../../app.routes';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { buttonNamed, configureReal, pollUntil } from './play/play-spec-support';
import { seedFighter } from './testing/character-fixtures';

// --- Campaign edit lock (plan-10 task-14-brief.md, ruling 7) ---------------------------------
//
// `CampaignEditLockService` itself (the full editOutsideSession x session.active x role matrix)
// is fully covered by its OWN spec (`campaign-edit-lock.spec.ts`) — these specs only assert
// `PlayTabComponent`'s WIRING: the banner renders with the right mode-specific copy, a
// representative sample of every mutating-action CATEGORY the brief names (hp/rest/inspiration/
// resources/conditions/notes/inventory) is disabled while locked, and — the documented ruling-7
// BOUNDARY — rolling dice is NEVER disabled by this lock (only by T10's own, unrelated "is a live
// campaign session open" gate).
describe('sheet — campaign edit lock (plan-10 task-14-brief.md, ruling 7)', () => {
  const CAMPAIGN_ID = '88888888-8888-8888-8888-888888888888';
  const CAMPAIGN_STREAM = `camp:${CAMPAIGN_ID}`;

  function setup(): void {
    configureReal(
      [],
      [
        provideRouter(routes),
        {
          provide: AuthService,
          useValue: { user: signal<AuthUser | null>({ userId: 'u1', username: 'Bob' }) },
        },
      ],
    );
  }

  beforeEach(async () => {
    setup();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.campaigns.clear(),
      db.blobs.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  function fullSettings(
    rule: CampaignSettings['houseRules']['editOutsideSession'],
  ): CampaignSettings {
    return {
      system: 'srd-5e-2024',
      packs: [],
      houseRules: {
        strictValidation: true,
        allowOverrides: true,
        editOutsideSession: rule,
        xpMode: 'xp',
        hpOnLevelUp: 'roll',
        encumbrance: 'standard',
        attunementMax: 3,
        startingLevel: 1,
      },
      visibility: { partySheets: 'overview', rolls: 'dm', allowPrivateRolls: true },
      join: { open: true, requireApproval: false },
    };
  }

  async function seedCampaign(
    rule: CampaignSettings['houseRules']['editOutsideSession'],
    opts: { role?: 'dm' | 'player'; sessionActive?: boolean } = {},
  ): Promise<void> {
    const campaignStore = TestBed.inject(CampaignStore);
    const drafts = [
      { type: 'campaign.settings_changed', v: 1, payload: { settings: fullSettings(rule) } },
      {
        type: 'member.joined',
        v: 1,
        payload: { userId: 'u1', displayName: 'Bob', role: opts.role ?? 'player' },
      },
      ...(opts.sessionActive ? [{ type: 'session.started', v: 1, payload: {} }] : []),
    ];
    await campaignStore.appendToStream(CAMPAIGN_STREAM, drafts);
  }

  async function linkCharacter(characterId: string): Promise<void> {
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
  }

  it('shows no banner and nothing disabled for a solo (non-campaign-linked) character', async () => {
    const characterId = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    expect(compiled.querySelector('.campaign-edit-lock-banner')).toBeNull();
    expect(buttonNamed(compiled, charactersEn.sheet.hp.damage).disabled).toBe(false);
  });

  it('shows no banner when houseRules.editOutsideSession is "free"', async () => {
    const characterId = await seedFighter('Ivan');
    await seedCampaign('free');
    await linkCharacter(characterId);

    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    expect(compiled.querySelector('.campaign-edit-lock-banner')).toBeNull();
    expect(buttonNamed(compiled, charactersEn.sheet.hp.damage).disabled).toBe(false);
  });

  it('shows no banner while a session is active, even under the "locked" rule', async () => {
    const characterId = await seedFighter('Ivan');
    await seedCampaign('locked', { sessionActive: true });
    await linkCharacter(characterId);

    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    expect(compiled.querySelector('.campaign-edit-lock-banner')).toBeNull();
    expect(buttonNamed(compiled, charactersEn.sheet.hp.damage).disabled).toBe(false);
  });

  it('exempts the campaign\'s own DM even under "locked" with no active session', async () => {
    const characterId = await seedFighter('Ivan');
    await seedCampaign('locked', { role: 'dm' });
    await linkCharacter(characterId);

    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    expect(compiled.querySelector('.campaign-edit-lock-banner')).toBeNull();
    expect(buttonNamed(compiled, charactersEn.sheet.hp.damage).disabled).toBe(false);
  });

  it('shows the DISTINCT dmApprovalV1 banner for the "dmApproval" rule (OWNER-FLAG: v1 has no approval queue)', async () => {
    const characterId = await seedFighter('Ivan');
    await seedCampaign('dmApproval');
    await linkCharacter(characterId);

    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    const banner = compiled.querySelector('.campaign-edit-lock-banner');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent?.trim()).toBe(campaignsEn.edit.dmApprovalV1);
  });

  /** Blocked either natively (`disabled`, also through a disabled `fieldset`) or the `hk-button`
   * way (`aria-disabled` with the reason as its hint). */
  function isBlocked(el: Element | null | undefined): boolean {
    return !!el && (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true');
  }

  function strapActions(): { id: string; disabled?: boolean; run(): void }[] {
    const config = TestBed.inject(ActionStrapService).config();
    return [...(config?.primary ?? []), ...(config?.secondary ?? [])];
  }

  it('locks the mutating action surface for an ordinary member under "locked" with no session, while ROLLING DICE STAYS ENABLED (the documented ruling-7 boundary)', async () => {
    const characterId = await seedFighter('Ivan');
    await seedCampaign('locked');
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId: CAMPAIGN_ID } },
      { type: 'condition.added', v: 1, payload: { conditionId: 'srd-5e-2024:condition/blinded' } },
    ]);

    const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const compiled = harness.routeNativeElement!;

    const banner = compiled.querySelector('.campaign-edit-lock-banner');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent?.trim()).toBe(campaignsEn.edit.locked);

    // HP (the gauge's controls sit in a disabled fieldset)
    for (const label of ['Damage', 'Heal', 'Temp HP']) {
      expect(isBlocked(buttonNamed(compiled, label)), label).toBe(true);
    }
    // Rest, Damage / Heal and Add condition on the action strap
    await pollUntil(fixture, () => strapActions().length > 0);
    for (const id of ['damage', 'heal', 'short-rest', 'long-rest', 'add-condition']) {
      expect(strapActions().find((a) => a.id === id)?.disabled, id).toBe(true);
    }
    // Rolling the plain d20 and opening the roll log stay available
    expect(strapActions().find((a) => a.id === 'roll')?.disabled).toBeFalsy();
    expect(strapActions().find((a) => a.id === 'roll-log')?.disabled).toBeFalsy();
    // Inspiration
    expect(isBlocked(compiled.querySelector('hk-inspiration-toggle button'))).toBe(true);
    // Conditions: add is blocked, and the already-present condition's remove affordance is hidden
    expect(isBlocked(buttonNamed(compiled, charactersEn.sheet.conditions.add))).toBe(true);
    expect(compiled.querySelector('.conditions__chips .hk-cond__end')).toBeNull();
    // Resources — fighter-1's "second wind" Use / Restore are blocked
    const resourceButtons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.resources button'),
    );
    expect(resourceButtons.length).toBeGreaterThan(0);
    for (const button of resourceButtons) expect(isBlocked(button)).toBe(true);
    // Spell slots (the fighter has none): nothing to check; the bag:
    expect(isBlocked(buttonNamed(compiled, charactersEn.sheet.inventory.addFromLibrary))).toBe(
      true,
    );
    expect(isBlocked(buttonNamed(compiled, charactersEn.sheet.inventory.addCustom))).toBe(true);
    const slot = Array.from(compiled.querySelectorAll<HTMLButtonElement>('.hk-slot')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Chain Mail'),
    )!;
    slot.click();
    await fixture.whenStable();
    expect(isBlocked(buttonNamed(compiled, charactersEn.sheet.inventory.remove))).toBe(true);
    expect(
      isBlocked(
        compiled.querySelector(`[aria-label="${charactersEn.sheet.inventory.qtyIncrease}"]`),
      ),
    ).toBe(true);
    // The coin pouch cannot be edited
    expect(compiled.querySelector('.hk-pouch__edit')).toBeNull();
    // Notes (opened from the strap): adding is blocked
    strapActions()
      .find((a) => a.id === 'notes')!
      .run();
    TestBed.tick();
    const overlay = document.querySelector<HTMLElement>('.cdk-overlay-container')!;
    expect(isBlocked(buttonNamed(overlay, charactersEn.sheet.notes.add))).toBe(true);

    // --- Rolling dice is NEVER gated by this lock (ruling 7's own boundary) ---
    const strength = Array.from(
      compiled.querySelectorAll<HTMLElement>('app-abilities-leaf .abilities__item'),
    ).find((li) => li.querySelector('.hk-ability__name')?.textContent?.trim() === 'Strength')!;
    for (const button of Array.from(strength.querySelectorAll('button'))) {
      expect(isBlocked(button)).toBe(false);
    }
  });

  // --- Encumbrance display (phase 4, plan 11, task 12) — the SAME overrides plumbing this
  // describe block's `fullSettings`/`seedCampaign`/`linkCharacter` harness already exercises for
  // the edit lock also drives `Sheet.carry` once `CharacterStore.sheet` threads campaign house
  // rules through `derive()` (task 12, ruling 1) — reused here rather than forked.
  describe('encumbrance display (Sheet.carry)', () => {
    it('renders nothing for a solo (never-linked) character — encumbrance off by default', async () => {
      const characterId = await seedFighter('Ivan');
      const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
      const fixture = harness.fixture;
      await fixture.whenStable();
      const compiled = harness.routeNativeElement!;

      expect(compiled.querySelector('.bag__carry')).toBeNull();
    });

    it('renders capacity/load and the "Normal" state badge for a campaign-linked character under the "standard" house rule', async () => {
      const characterId = await seedFighter('Ivan');
      await seedCampaign('free'); // fullSettings() defaults houseRules.encumbrance to 'standard'
      await linkCharacter(characterId);

      const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
      const fixture = harness.fixture;
      await fixture.whenStable();
      const compiled = harness.routeNativeElement!;

      const carry = compiled.querySelector('.bag__carry');
      expect(carry).not.toBeNull();
      const summary = carry!.querySelector('.bag__carry-summary')!.textContent.trim();
      // Fighter fixture: str 17 -> standard capacity = 17 * 15 = 255 lb; chain mail (55) + longsword
      // (3) + shield (6) = 64 lb load, matching this fixture's own known equipped-item weights.
      expect(summary).toBe('64 / 255 lb carried');
      const state = carry!.querySelector('.bag__carry-state')!;
      expect(state.textContent.trim()).toBe(charactersEn.sheet.inventory.carry.state.normal);
      expect(state.classList.contains('bag__carry-state--warn')).toBe(false);
      expect(carry!.querySelector('.bag__carry-penalty')).toBeNull();
    });

    it('renders the warn badge + speed penalty note once the graded threshold is actually exceeded', async () => {
      const characterId = await seedFighter('Ivan');
      const campaignStore = TestBed.inject(CampaignStore);
      const settings = fullSettings('free');
      await campaignStore.appendToStream(CAMPAIGN_STREAM, [
        {
          type: 'campaign.settings_changed',
          v: 1,
          payload: {
            settings: {
              ...settings,
              houseRules: { ...settings.houseRules, encumbrance: 'variant' },
            },
          },
        },
        {
          type: 'member.joined',
          v: 1,
          payload: { userId: 'u1', displayName: 'Bob', role: 'player' },
        },
      ]);
      await linkCharacter(characterId);
      // Push this fighter's load well past str17*5=85 (the variant "encumbered" threshold) with a
      // heavy custom item — the display-only path this task adds, not a new engine computation.
      const characterStore = TestBed.inject(CharacterStore);
      await characterStore.appendTx([
        {
          type: 'item.added',
          v: 1,
          payload: {
            instanceId: '33333333-3333-4333-8333-333333333333',
            name: 'Anvil',
            qty: 1,
            custom: { weight: 100 },
          },
        },
      ]);

      const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
      const fixture = harness.fixture;
      await fixture.whenStable();
      const compiled = harness.routeNativeElement!;

      const carry = compiled.querySelector('.bag__carry')!;
      const state = carry.querySelector('.bag__carry-state')!;
      expect(state.textContent.trim()).toBe(charactersEn.sheet.inventory.carry.state.encumbered);
      expect(state.classList.contains('bag__carry-state--warn')).toBe(true);
      const penalty = carry.querySelector('.bag__carry-penalty')!;
      expect(penalty.textContent.trim()).toBe(
        charactersEn.sheet.inventory.carry.speedPenalty.replace('{value}', '10'),
      );
    });

    it('a11y: the state badge and speed-penalty note are plain readable text, not icon-only', async () => {
      const characterId = await seedFighter('Ivan');
      await seedCampaign('free');
      await linkCharacter(characterId);

      const harness = await RouterTestingHarness.create(`/c/${characterId}/play`);
      const fixture = harness.fixture;
      await fixture.whenStable();
      const compiled = harness.routeNativeElement!;

      const state = compiled.querySelector('.bag__carry-state')!;
      expect(state.textContent.trim().length).toBeGreaterThan(0);
    });
  });
});
