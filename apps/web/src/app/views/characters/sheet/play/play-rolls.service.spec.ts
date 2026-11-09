import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import type { CampaignSettings } from '@hk/protocol';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import { bareCharacterId } from '@shared/services/campaigns/campaign-link-sequence';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SyncService, type SyncStateValue } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../testing/character-fixtures';
import { AbilitiesLeafComponent } from './abilities-leaf/abilities-leaf.component';
import { AttacksLeafComponent } from './attacks-leaf/attacks-leaf.component';
import { configureReal as configureBase, mountSheetParts } from './play-spec-support';
import { RollLogDialogComponent } from './roll-log-dialog.component';
import { SkillsLeafComponent } from './skills-leaf/skills-leaf.component';

// Every roll button on the sheet (ability checks and saves, skills, attack damage, the roll log's
// manual entry) goes through `PlayRollsService`; these specs drive the real leaves and the roll-log
// panel side by side, exactly the way the sheet places them. The ROW'S already-derived total is the
// roll's modifier — never recomputed.

/** `configureReal` plus the `DialogRef` the roll-log host (opened from the strap in the app) needs. */
function configureReal(...args: Parameters<typeof configureBase>): void {
  const [packs = [], providers = []] = args;
  configureBase(packs, [
    { provide: DialogRef, useValue: new DialogRef(() => undefined) },
    ...providers,
  ]);
}

describe('PlayRollsService — dice roller and roll log', () => {
  beforeEach(async () => {
    // Same locale-leak guard every other describe block in this file documents.
    localStorage.removeItem('hk.locale');
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
    vi.restoreAllMocks();
  });

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  /** The Check / Save roll button of an ability (each carries the ability's name in its label). */
  function abilityRollButton(
    compiled: HTMLElement,
    ability: string,
    kind: 'check' | 'save',
  ): HTMLButtonElement {
    const label = (
      kind === 'check' ? charactersEn.sheet.roll.checkNamed : charactersEn.sheet.roll.saveNamed
    ).replace('{name}', ability);
    const button = compiled.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`no "${label}" button`);
    return button;
  }

  /** The Roll button of a skill row, by the skill's name. */
  function skillRollButton(compiled: HTMLElement, label: string): HTMLButtonElement {
    const row = Array.from(compiled.querySelectorAll<HTMLElement>('hk-skill-row')).find(
      (r) => r.querySelector('.hk-sk__name')?.textContent?.trim() === label,
    );
    if (!row) throw new Error(`no skill row matching "${label}"`);
    return row.querySelector<HTMLButtonElement>('button')!;
  }

  /** Same scripting technique `rest-dialog.component.spec.ts` documents in full — narrowed to the
   * EXACT `Uint32Array` length-1 shape `cryptoRng` passes, so `uuidv7()`'s own entropy draw falls
   * through to the real `crypto.getRandomValues` untouched. Consumed in call order. */
  function scriptRolls(targets: { value: number; sides: number }[]): void {
    let i = 0;
    const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
      if (array instanceof Uint32Array && array.length === 1) {
        const t = targets[i++];
        const frac = t ? (t.value - 0.5) / t.sides : 0;
        array[0] = Math.floor(frac * 2 ** 32);
        return array;
      }
      return real(array);
    }) as typeof crypto.getRandomValues);
  }

  it('a skill roll uses 1d20 + the derived total exactly, logs it, and announces it', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const athleticsTotal = characterStore.sheet()!.skills['athletics'].total.value;

    const { compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const announceSpy = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    scriptRolls([{ value: 14, sides: 20 }]);
    skillRollButton(compiled, 'Athletics').click();
    TestBed.tick();

    const rollLogService = TestBed.inject(RollLogService);
    expect(rollLogService.entries()).toHaveLength(1);
    const [entry] = rollLogService.entries();
    expect(entry).toMatchObject({
      labelKey: 'sheet.roll.entries.skill',
      params: { name: 'Athletics' },
      dice: [{ sides: 20, value: 14, kept: true }],
      modifier: athleticsTotal,
      total: 14 + athleticsTotal,
    });
    expect(entry?.advantage).toBeUndefined();
    expect(entry?.manual).toBeUndefined();

    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy.mock.calls[0]?.[0] as string).toContain(String(14 + athleticsTotal));
  });

  it('an ability check uses the plain mod, and a save uses the derived save total', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const strMod = characterStore.sheet()!.abilities['str'].mod;
    const strSave = characterStore.sheet()!.abilities['str'].save.value;

    const { compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const rollLogService = TestBed.inject(RollLogService);

    // ONE `scriptRolls` call covering both rolls in consumption order (`getRandomValues` is only
    // ever spied ONCE per test here — re-spying an already-spied `crypto.getRandomValues` would
    // capture the mock itself as "real", not the native implementation, and recurse).
    scriptRolls([
      { value: 9, sides: 20 },
      { value: 3, sides: 20 },
    ]);

    abilityRollButton(compiled, 'Strength', 'check').click();
    TestBed.tick();
    expect(rollLogService.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.check',
      modifier: strMod,
      total: 9 + strMod,
    });

    abilityRollButton(compiled, 'Strength', 'save').click();
    TestBed.tick();
    expect(rollLogService.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.save',
      modifier: strSave,
      total: 3 + strSave,
    });
  });

  it('advantage rolls 2d20 keep-highest for the next d20 roll only, then resets to Normal; disadvantage keeps lowest', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const strMod = characterStore.sheet()!.abilities['str'].mod;

    const { compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const rollLogService = TestBed.inject(RollLogService);

    // ONE `scriptRolls` call covering both 2-die rolls in consumption order (see the previous
    // describe block's own comment: re-spying an already-spied `crypto.getRandomValues` within
    // the same test captures the MOCK itself as "real", not the native implementation).
    scriptRolls([
      { value: 5, sides: 20 },
      { value: 17, sides: 20 },
      { value: 16, sides: 20 },
      { value: 2, sides: 20 },
    ]);

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    TestBed.tick();

    abilityRollButton(compiled, 'Strength', 'check').click();
    TestBed.tick();

    expect(rollLogService.entries()[0]).toMatchObject({
      dice: [
        { sides: 20, value: 5, kept: false },
        { sides: 20, value: 17, kept: true },
      ],
      advantage: 'adv',
      total: 17 + strMod,
    });
    // One-shot: back to Normal after consuming the toggle.
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-pressed'),
    ).toBe('true');

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.disadvantage).click();
    TestBed.tick();

    abilityRollButton(compiled, 'Strength', 'check').click();
    TestBed.tick();

    expect(rollLogService.entries()[0]).toMatchObject({
      dice: [
        { sides: 20, value: 16, kept: false },
        { sides: 20, value: 2, kept: true },
      ],
      advantage: 'dis',
      total: 2 + strMod,
    });
  });

  it("an attack damage roll parses the row's own dice string and adds the derived bonus, with no advantage applied", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const longsword = characterStore.sheet()!.attacks[0];
    expect(longsword.damage.dice).toBe('1d8'); // fixture assumption — longsword, one-handed
    const bonus = longsword.damage.bonus.value;

    const { compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const rollLogService = TestBed.inject(RollLogService);

    // Advantage set beforehand must NOT affect a damage roll (d20-only mechanic).
    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    TestBed.tick();

    scriptRolls([{ value: 6, sides: 8 }]);
    const attackRow = compiled.querySelector<HTMLButtonElement>('.attacks__damage')!;
    attackRow.click();
    TestBed.tick();

    const [entry] = rollLogService.entries();
    expect(entry).toMatchObject({
      labelKey: 'sheet.roll.entries.attackDamage',
      dice: [{ sides: 8, value: 6, kept: true }],
      modifier: bonus,
      total: 6 + bonus,
    });
    expect(entry?.advantage).toBeUndefined();
    // The advantage toggle is untouched by a damage roll (never consumed).
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('a manual log entry appended through the panel is flagged manual and carries the typed total', async () => {
    await seedFighter('Ivan');

    const { compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );

    const amountInput = compiled.querySelector<HTMLInputElement>(
      '.roll-log-panel__manual input[type="number"]',
    )!;
    amountInput.value = '11';
    amountInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(compiled, charactersEn.sheet.roll.manual.add).click();
    TestBed.tick();

    const rollLogService = TestBed.inject(RollLogService);
    expect(rollLogService.entries()[0]).toMatchObject({ total: 11, manual: true });
  });
});

describe('PlayRollsService — campaign roll publishing (plan-10 task-10-brief.md)', () => {
  const CAMPAIGN_ID = '99999999-9999-9999-9999-999999999999';
  const CAMPAIGN_STREAM = `camp:${CAMPAIGN_ID}`;

  let syncStateFor: (streamId: string) => WritableSignal<SyncStateValue>;

  function setup(): void {
    const syncStates = new Map<string, WritableSignal<SyncStateValue>>();
    syncStateFor = (streamId) => {
      let s = syncStates.get(streamId);
      if (!s) {
        s = signal<SyncStateValue>('offline');
        syncStates.set(streamId, s);
      }
      return s;
    };
    configureReal(
      [],
      [
        {
          provide: AuthService,
          useValue: { user: signal<AuthUser | null>({ userId: 'u1', username: 'alice' }) },
        },
        { provide: SyncService, useValue: { syncState: syncStateFor } },
      ],
    );
  }

  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
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
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
    vi.restoreAllMocks();
  });

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  /** The Check / Save roll button of an ability (each carries the ability's name in its label). */
  function abilityRollButton(
    compiled: HTMLElement,
    ability: string,
    kind: 'check' | 'save',
  ): HTMLButtonElement {
    const label = (
      kind === 'check' ? charactersEn.sheet.roll.checkNamed : charactersEn.sheet.roll.saveNamed
    ).replace('{name}', ability);
    const button = compiled.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`no "${label}" button`);
    return button;
  }

  // Same exact scripting technique the "dice roller" describe block above documents in full.
  function scriptRolls(targets: { value: number; sides: number }[]): void {
    let i = 0;
    const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
      if (array instanceof Uint32Array && array.length === 1) {
        const t = targets[i++];
        const frac = t ? (t.value - 0.5) / t.sides : 0;
        array[0] = Math.floor(frac * 2 ** 32);
        return array;
      }
      return real(array);
    }) as typeof crypto.getRandomValues);
  }

  function expectedModifierTerm(n: number): string {
    return n === 0 ? '' : n > 0 ? `+${n}` : `${n}`;
  }

  // `publishRoll` is deliberately fire-and-forget from the CLICK handler's own perspective (ruling
  // 5 — a roll publish is never awaited/blocking, matching every other `appendTx`/`appendDraft`
  // call in this component) — its underlying `CampaignStore.appendToStream` promise settles on its
  // OWN microtask chain (real fake-indexeddb I/O), which `fixture.whenStable()` does not track
  // (nothing here is a zone-tracked/signal-driven pending task). A short REAL timer flush — same
  // "small real duration, never `vi.useFakeTimers()`" posture `party-overview-publisher.service
  // .spec.ts`'s own `waitPastDebounce` documents — lets that chain settle before assertions read
  // storage.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  function fullSettings(overrides: Partial<CampaignSettings['visibility']> = {}): CampaignSettings {
    return {
      system: 'srd-5e-2024',
      packs: [],
      houseRules: {
        strictValidation: true,
        allowOverrides: true,
        editOutsideSession: 'free',
        xpMode: 'xp',
        hpOnLevelUp: 'roll',
        encumbrance: 'standard',
        attunementMax: 3,
        startingLevel: 1,
      },
      visibility: { partySheets: 'overview', rolls: 'dm', allowPrivateRolls: true, ...overrides },
      join: { open: true, requireApproval: false },
    };
  }

  async function linkAndOpenSession(characterId: string): Promise<void> {
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    syncStateFor(CAMPAIGN_STREAM).set('synced');
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
  }

  it('hides the picker and never publishes for a solo (non-campaign-linked) character', async () => {
    await seedFighter('Ivan');
    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    expect(compiled.querySelector('.roll-log-panel__visibility')).toBeNull();

    const campaignStore = TestBed.inject(CampaignStore);
    const appendSpy = vi.spyOn(campaignStore, 'appendToStream');

    scriptRolls([{ value: 10, sides: 20 }]);
    abilityRollButton(compiled, 'Strength', 'check').click();
    await fixture.whenStable();

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('does not show the picker or publish while the linked campaign has no live session (syncState stays "offline")', async () => {
    const characterId = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    // Deliberately never flip syncStateFor away from its 'offline' default.
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);

    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    expect(compiled.querySelector('.roll-log-panel__visibility')).toBeNull();

    scriptRolls([{ value: 10, sides: 20 }]);
    abilityRollButton(compiled, 'Strength', 'check').click();
    await fixture.whenStable();

    const published = (await TestBed.inject(EventsRepository).byStream(CAMPAIGN_STREAM)).filter(
      (e) => e.type === 'roll.logged',
    );
    expect(published).toHaveLength(0);
  });

  it('shows the picker defaulting to settings.visibility.rolls, and publishes roll.logged with formula/kind/ALL rolled dice/total/characterId/visibility for an advantage check', async () => {
    const characterId = await seedFighter('Ivan');
    const campaignStore = TestBed.inject(CampaignStore);
    await campaignStore.appendToStream(CAMPAIGN_STREAM, [
      {
        type: 'campaign.settings_changed',
        v: 1,
        payload: { settings: fullSettings({ rolls: 'dm' }) },
      },
    ]);
    await linkAndOpenSession(characterId);

    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const strMod = TestBed.inject(CharacterStore).sheet()!.abilities['str'].mod;

    // Defaults to the campaign's own setting ('dm'), not the schema's own 'everyone' fallback.
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.visibility.dm).getAttribute('aria-pressed'),
    ).toBe('true');

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    await fixture.whenStable();
    scriptRolls([
      { value: 5, sides: 20 },
      { value: 17, sides: 20 },
    ]);
    abilityRollButton(compiled, 'Strength', 'check').click();
    await fixture.whenStable();
    await settle();

    const events = await TestBed.inject(EventsRepository).byStream(CAMPAIGN_STREAM);
    const published = events.filter((e) => e.type === 'roll.logged');
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({
      characterId: bareCharacterId(characterId),
      formula: `2d20kh1${expectedModifierTerm(strMod)}`,
      // BOTH dice (kept AND dropped) — the ruling: "include ALL rolled dice in results".
      results: [
        { die: 'd20', value: 5 },
        { die: 'd20', value: 17 },
      ],
      total: 17 + strMod,
      kind: 'check',
      visibility: 'dm',
    });
    expect(published[0]?.seq).toBeUndefined(); // pending, like every other member-authored event
  });

  it('publishes the CURRENTLY SELECTED visibility, not the campaign default, once the player changes the picker', async () => {
    const characterId = await seedFighter('Ivan');
    await linkAndOpenSession(characterId); // no settings posted -> default 'everyone'

    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );

    buttonNamed(compiled, charactersEn.sheet.roll.visibility.private).click();
    await fixture.whenStable();

    scriptRolls([{ value: 9, sides: 20 }]);
    abilityRollButton(compiled, 'Strength', 'save').click();
    await fixture.whenStable();
    await settle();

    const published = (await TestBed.inject(EventsRepository).byStream(CAMPAIGN_STREAM)).filter(
      (e) => e.type === 'roll.logged',
    );
    expect(published[0]?.payload).toMatchObject({ visibility: 'private', kind: 'save' });
  });

  it('an attack damage roll publishes kind "damage" with the reconstructed dice+bonus formula', async () => {
    const characterId = await seedFighter('Ivan');
    await linkAndOpenSession(characterId);

    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );
    const longsword = TestBed.inject(CharacterStore).sheet()!.attacks[0];
    const bonus = longsword.damage.bonus.value;

    scriptRolls([{ value: 6, sides: 8 }]);
    const attackRow = compiled.querySelector<HTMLButtonElement>('.attacks__damage')!;
    attackRow.click();
    await fixture.whenStable();
    await settle();

    const published = (await TestBed.inject(EventsRepository).byStream(CAMPAIGN_STREAM)).filter(
      (e) => e.type === 'roll.logged',
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({
      formula: `1d8${expectedModifierTerm(bonus)}`,
      results: [{ die: 'd8', value: 6 }],
      total: 6 + bonus,
      kind: 'damage',
    });
  });

  it('never publishes a manual log entry, even in campaign context (no dice/formula to report)', async () => {
    const characterId = await seedFighter('Ivan');
    await linkAndOpenSession(characterId);

    const { fixture, compiled } = await mountSheetParts(
      AbilitiesLeafComponent,
      SkillsLeafComponent,
      AttacksLeafComponent,
      RollLogDialogComponent,
    );

    const amountInput = compiled.querySelector<HTMLInputElement>(
      '.roll-log-panel__manual input[type="number"]',
    )!;
    amountInput.value = '9';
    amountInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonNamed(compiled, charactersEn.sheet.roll.manual.add).click();
    await fixture.whenStable();

    const published = (await TestBed.inject(EventsRepository).byStream(CAMPAIGN_STREAM)).filter(
      (e) => e.type === 'roll.logged',
    );
    expect(published).toHaveLength(0);
  });

  describe('allowPrivateRolls gating', () => {
    it('omits "Private" from the picker when the campaign settings set allowPrivateRolls: false', async () => {
      const characterId = await seedFighter('Ivan');
      const campaignStore = TestBed.inject(CampaignStore);
      await campaignStore.appendToStream(CAMPAIGN_STREAM, [
        {
          type: 'campaign.settings_changed',
          v: 1,
          payload: { settings: fullSettings({ allowPrivateRolls: false }) },
        },
      ]);
      await linkAndOpenSession(characterId);

      const { compiled } = await mountSheetParts(
        AbilitiesLeafComponent,
        SkillsLeafComponent,
        AttacksLeafComponent,
        RollLogDialogComponent,
      );

      const group = compiled.querySelector('.roll-log-panel__visibility')!;
      expect(group).not.toBeNull();
      expect(
        Array.from(group.querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === charactersEn.sheet.roll.visibility.private,
        ),
      ).toBe(false);
    });

    it('shows "Private" when no settings have been posted yet (schema-null settings default to allowPrivateRolls: true)', async () => {
      const characterId = await seedFighter('Ivan');
      await linkAndOpenSession(characterId);

      const { compiled } = await mountSheetParts(
        AbilitiesLeafComponent,
        SkillsLeafComponent,
        AttacksLeafComponent,
        RollLogDialogComponent,
      );

      const group = compiled.querySelector('.roll-log-panel__visibility')!;
      expect(
        Array.from(group.querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === charactersEn.sheet.roll.visibility.private,
        ),
      ).toBe(true);
    });
  });
});
