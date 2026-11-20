import { Component, input, output, signal, type WritableSignal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { MembershipRole } from '@hk/protocol';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import type { CampaignState } from '@shared/services/campaigns/campaign-projection';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import shellEn from '../../../../assets/i18n/shell/en.json';
import { CampaignSelectionService } from '../shell/campaign-selection.service';
import { HandoverCharacterDialogComponent } from './handover-character-dialog.component';
import { MemberSheetDrawerComponent } from './member-sheet-drawer/member-sheet-drawer.component';
import { PartyTabComponent } from './party-tab.component';
import { UnlinkCharacterDialogComponent } from './unlink-character-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

@Component({ selector: 'app-member-sheet-drawer', template: '<div class="drawer-stub"></div>' })
class DrawerStub {
  readonly campaignId = input.required<string>();
  readonly characterId = input.required<string>();
  readonly name = input.required<string>();
  readonly opener = input<unknown>(null);
  readonly closed = output<void>();
}

const CLASS_NAMES: Record<string, string> = { 'srd:class/fighter': 'Fighter' };
const CONDITION_NAMES: Record<string, string> = { 'srd:condition/prone': 'Prone' };

function stubEngineFacade(): Partial<EngineFacade> {
  return {
    localizer: signal({
      name: (id: string) => CLASS_NAMES[id] ?? CONDITION_NAMES[id] ?? id,
    }) as unknown as EngineFacade['localizer'],
  };
}

function mkState(overrides: Partial<CampaignState> = {}): Partial<CampaignState> {
  return {
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    settings: null,
    members: new Map<string, { displayName: string; role: MembershipRole; removed: boolean }>(),
    roster: new Map(),
    overviews: new Map(),
    ...overrides,
  };
}

const encounterSpies = {
  start: vi.fn().mockResolvedValue(undefined),
  advance: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
};

function configure(options: {
  role?: MembershipRole;
  state?: Partial<CampaignState>;
  userId?: string | null;
  live?: { userId: string; displayName: string; role: string; online: boolean }[] | null;
  encounter?: { id: string; round: number; number: number } | null;
}): { navigateSpy: ReturnType<typeof vi.fn>; dialogOpenSpy: ReturnType<typeof vi.fn> } {
  const navigateSpy = vi.fn().mockResolvedValue(true);
  const dialogOpenSpy = vi
    .fn()
    .mockReturnValue({ closed: Promise.resolve(undefined), close: vi.fn() });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      {
        provide: CampaignStore,
        useValue: {
          state: signal(options.state ?? mkState()),
          role: signal(options.role ?? 'player'),
          campaignId: signal('00000000-0000-4000-8000-000000000001'),
          gatewayAppend: vi.fn().mockResolvedValue({ acked: [], rejected: [] }),
          encounter: signal(options.encounter ?? null),
          startEncounter: encounterSpies.start,
          advanceRound: encounterSpies.advance,
          endEncounter: encounterSpies.end,
        },
      },
      {
        provide: AuthService,
        useValue: {
          user: signal<AuthUser | null>(
            options.userId === null
              ? null
              : { userId: options.userId ?? 'u-player', username: 'Bob' },
          ),
        },
      },
      { provide: EngineFacade, useValue: stubEngineFacade() },
      { provide: SyncService, useValue: { membersFor: () => signal(options.live ?? null) } },
      // [plan-10 Task 9] Spied/mocked rather than the real `DialogService` — this spec's own
      // TestBed provides none of `MemberSheetDialogComponent`'s own DI needs (SyncService/
      // PackStore/EngineFacade with a real pack); that component's own rendering is exhaustively
      // covered by `member-sheet-dialog.component.spec.ts` instead. This boundary only asserts
      // PartyTabComponent calls `DialogService.open` with the right component/data.
      { provide: DialogService, useValue: { open: dialogOpenSpy } },
    ],
  });
  // The drawer's own DI (sync, packs, the foreign session) is covered by its spec: here it is a
  // stand-in with the same selector, inputs and output.
  TestBed.overrideComponent(PartyTabComponent, {
    remove: { imports: [MemberSheetDrawerComponent] },
    add: { imports: [DrawerStub] },
  });
  TestBed.inject(Router).navigate = navigateSpy;
  return { navigateSpy, dialogOpenSpy };
}

/** A press on a card's body, the way the DM picks a member. */
function pressCard(compiled: HTMLElement, name: string): void {
  const card = Array.from(compiled.querySelectorAll<HTMLElement>('.party-tab__card')).find(
    (c) => c.getAttribute('aria-label') === name,
  )!;
  card.click();
}

const OVERVIEW = {
  hp: 8,
  hpMax: 12,
  temp: 2,
  ac: 19,
  level: 1,
  classes: [{ classId: 'srd:class/fighter', level: 1 }],
  conditions: ['srd:condition/prone'],
  concentration: true,
  passivePerception: 13,
};

describe('PartyTabComponent', () => {
  it('renders a full overview card (hp bar+text, ac, level/classes, conditions, concentration, passive perception)', async () => {
    configure({
      role: 'player',
      state: mkState({
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        overviews: new Map([['char-1', OVERVIEW]]),
        members: new Map([['u-player', { displayName: 'Bob', role: 'player', removed: false }]]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = compiled.querySelector('.party-tab__card')!;
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('aria-label')).toBe('Ivan');
    expect(card.querySelector('.hk-party__name-text')?.textContent?.trim()).toBe('Ivan');
    const meter = card.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('8');
    expect(meter.getAttribute('aria-valuemax')).toBe('12');
    expect(meter.getAttribute('aria-valuetext')).toBe('8 of 12 hit points, 2 temporary');
    expect(card.querySelector('.hk-party__hp-num')?.textContent).toContain('8');
    expect(card.querySelector('hk-shield-badge')?.textContent).toContain('19');
    expect(card.querySelector('.party-tab__stat')?.textContent).toContain('13');
    expect(card.querySelector('.hk-party__sub')?.textContent).toContain('Fighter');
    expect(card.querySelector('.hk-party__sub')?.textContent).toContain('1');
    expect(card.querySelector('.hk-party__sub')?.textContent).toContain('Played by Bob');
    expect(card.querySelector('.hk-party__orb')).not.toBeNull();
    expect(card.querySelector('hk-condition-chip .hk-cond__name')?.textContent?.trim()).toBe(
      'Prone',
    );
  });

  // Plan 20 task 12.6: a condition chip's accessible name is the localized name, not the id.
  it('names a condition chip in the active language (ru)', async () => {
    configure({
      state: mkState({
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        overviews: new Map([['char-1', OVERVIEW]]),
      }),
    });
    (TestBed.inject(EngineFacade).localizer as unknown as WritableSignal<unknown>).set({
      locale: 'ru',
      name: (id: string) => (id === 'srd:condition/prone' ? 'Лежащий' : ''),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.hk-cond__main')!;
    expect(chip.getAttribute('aria-label')).toBe('Лежащий');
    expect(chip.getAttribute('aria-label')).not.toContain('prone');
  });

  it('renders a name-only card for a roster entry with no overview yet', async () => {
    configure({
      role: 'player',
      state: mkState({
        roster: new Map([['char-1', { ownerId: 'u-other', name: 'Grog', left: false }]]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = compiled.querySelector('.party-tab__card')!;
    expect(card.querySelector('.party-tab__name')?.textContent?.trim()).toBe('Grog');
    expect(card.querySelector('[role="meter"]')).toBeNull();
    expect(card.querySelector('.party-tab__no-overview')).not.toBeNull();
  });

  it('marks a left:true roster entry visibly distinct, with a "left the party" badge, but still shows its overview', async () => {
    configure({
      role: 'dm',
      state: mkState({
        roster: new Map([['char-1', { ownerId: 'u-other', name: 'Departed', left: true }]]),
        overviews: new Map([
          [
            'char-1',
            {
              hp: 1,
              hpMax: 1,
              temp: 0,
              ac: 10,
              level: 1,
              classes: [],
              conditions: [],
              concentration: false,
              passivePerception: 10,
            },
          ],
        ]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = compiled.querySelector('.party-tab__card')!;
    expect(card.getAttribute('data-left')).toBe('true');
    expect(card.querySelector('.party-tab__left-badge')?.textContent?.trim()).toBe(
      'Left the party',
    );
    expect(card.querySelector('[role="meter"]')).not.toBeNull();
  });

  describe('partySheets gating (doc-08: not server-filtered — client renders name-only for members under "none")', () => {
    function stateWithOverview(): Partial<CampaignState> {
      return mkState({
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        overviews: new Map([
          [
            'char-1',
            {
              hp: 12,
              hpMax: 12,
              temp: 0,
              ac: 16,
              level: 1,
              classes: [],
              conditions: [],
              concentration: false,
              passivePerception: 10,
            },
          ],
        ]),
      });
    }

    it('renders name-only for a MEMBER when partySheets is "none", even though an overview exists', async () => {
      configure({
        role: 'player',
        state: {
          ...stateWithOverview(),
          settings: {
            houseRules: { xpMode: 'xp' },
            visibility: { partySheets: 'none', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card [role="meter"]')).toBeNull();
      expect(compiled.querySelector('.party-tab__hidden-notice')).not.toBeNull();
    });

    it('the DM ALWAYS sees full overview detail, even when partySheets is "none"', async () => {
      configure({
        role: 'dm',
        state: {
          ...stateWithOverview(),
          settings: {
            houseRules: { xpMode: 'xp' },
            visibility: { partySheets: 'none', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card [role="meter"]')).not.toBeNull();
      expect(compiled.querySelector('.party-tab__hidden-notice')).toBeNull();
    });

    it('a MEMBER sees full detail under "overview" and "full" (only DM-only drill-in — Task 9 — differs at "full")', async () => {
      configure({
        role: 'player',
        state: {
          ...stateWithOverview(),
          settings: {
            houseRules: { xpMode: 'xp' },
            visibility: { partySheets: 'overview', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card [role="meter"]')).not.toBeNull();
    });
  });

  it('renders a row per member without an active character, with a removed badge where applicable', async () => {
    configure({
      role: 'dm',
      state: mkState({
        members: new Map([
          ['u-dm', { displayName: 'Alice', role: 'dm', removed: false }],
          ['u-player', { displayName: 'Bob', role: 'player', removed: false }],
          ['u-gone', { displayName: 'Charlie', role: 'player', removed: true }],
        ]),
        roster: new Map([['char-1', { ownerId: 'u-dm', name: 'Alice-PC', left: false }]]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = compiled.querySelectorAll('.party-tab__no-character-row');
    expect(rows).toHaveLength(2); // u-player and u-gone — u-dm owns an active roster entry
    const names = Array.from(rows).map((r) =>
      r.querySelector('.party-tab__no-character-name')?.textContent?.trim(),
    );
    expect(names).toEqual(['Bob', 'Charlie']);
    expect(rows[1].querySelector('.party-tab__no-character-removed-badge')).not.toBeNull();
    expect(rows[0].querySelector('.party-tab__no-character-removed-badge')).toBeNull();
  });

  it('a member who owns a LEFT (not active) character still appears in the "no character" section', async () => {
    configure({
      role: 'dm',
      state: mkState({
        members: new Map([['u-player', { displayName: 'Bob', role: 'player', removed: false }]]),
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'OldPC', left: true }]]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.party-tab__no-character-row')).toHaveLength(1);
  });

  describe('empty-state "link a character" CTA (Task 7\'s flagged missing entry point)', () => {
    it('shows the CTA when the signed-in user has no active character in this roster', async () => {
      const { navigateSpy } = configure({
        role: 'player',
        userId: 'u-player',
        state: mkState({ roster: new Map() }),
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const button = compiled.querySelector<HTMLButtonElement>('.party-tab__link-cta-action')!;
      expect(button).not.toBeNull();
      button.click();
      await fixture.whenStable();

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      const [commands, extras] = navigateSpy.mock.calls[0] as [unknown, { relativeTo?: unknown }];
      expect(commands).toEqual(['../link-character']);
      expect(extras.relativeTo).toBeDefined();
    });

    it('hides the CTA once the signed-in user owns an active roster entry', async () => {
      configure({
        role: 'player',
        userId: 'u-player',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        }),
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__link-cta')).toBeNull();
    });

    it("hides the CTA when the user's only roster entry has left (left:true doesn't count as active)", async () => {
      configure({
        role: 'player',
        userId: 'u-player',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: true }]]),
        }),
      });
      // A left entry means NOT active -> the CTA should show (regression guard against treating
      // any roster row, regardless of `left`, as "already linked").
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__link-cta')).not.toBeNull();
    });
  });

  it('shows the empty state when the roster has no entries at all', async () => {
    configure({ role: 'dm', state: mkState({ roster: new Map() }) });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.party-tab__empty')).not.toBeNull();
    expect(compiled.querySelector('.party-tab__card')).toBeNull();
  });

  // plan-10 task-9-brief.md: DM party-sheet drill-in — gated on ruling 8's exact wording
  // ("'full' additionally enables DM (and only DM) sheet-subscribe drill-in").
  describe('DM sheet-subscribe drill-in ("View sheet")', () => {
    function stateWithFullVisibility(): Partial<CampaignState> {
      return mkState({
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        settings: {
          houseRules: { xpMode: 'xp' },
          visibility: { partySheets: 'full', rolls: 'everyone', allowPrivateRolls: true },
        } as unknown as CampaignState['settings'],
      });
    }

    function viewSheetButton(compiled: HTMLElement): HTMLButtonElement | null {
      return (
        Array.from(compiled.querySelectorAll<HTMLButtonElement>('.party-tab__card button')).find(
          (b) => b.textContent?.trim() === 'View sheet',
        ) ?? null
      );
    }

    function drawerInputs(fixture: ComponentFixture<PartyTabComponent>) {
      const found = fixture.debugElement.query(By.directive(DrawerStub));
      if (!found) return null;
      const drawer = found.componentInstance as DrawerStub;
      return {
        campaignId: drawer.campaignId(),
        characterId: drawer.characterId(),
        name: drawer.name(),
      };
    }

    it('DM + partySheets "full": renders the "View sheet" button, which opens the member sheet drawer with the right data', async () => {
      configure({ role: 'dm', state: stateWithFullVisibility() });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(drawerInputs(fixture)).toBeNull();
      const button = viewSheetButton(compiled);
      expect(button).not.toBeNull();
      button?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(drawerInputs(fixture)).toEqual({
        campaignId: '00000000-0000-4000-8000-000000000001',
        characterId: 'char-1',
        name: 'Ivan',
      });
    });

    it('a card with an overview opens the same drawer from its book button, and the drawer going away removes it', async () => {
      configure({
        role: 'dm',
        state: {
          ...stateWithFullVisibility(),
          overviews: new Map([['char-1', OVERVIEW]]),
        },
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      compiled.querySelector<HTMLButtonElement>('.hk-party__open')!.click();
      fixture.detectChanges();
      expect(drawerInputs(fixture)?.characterId).toBe('char-1');

      const drawer = fixture.debugElement.query(By.directive(DrawerStub));
      (drawer.componentInstance as DrawerStub).closed.emit();
      fixture.detectChanges();
      expect(drawerInputs(fixture)).toBeNull();
    });

    it('the leaf footer opens the same drawer ("Open full sheet") for the selected member', async () => {
      configure({ role: 'dm', state: stateWithFullVisibility() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      compiled.querySelector<HTMLButtonElement>('.qfx__open-sheet')!.click();
      fixture.detectChanges();
      expect(drawerInputs(fixture)?.name).toBe('Ivan');
    });

    it('a card with an overview has no book button when the DM is not allowed the drill-in', async () => {
      configure({
        role: 'player',
        state: { ...stateWithFullVisibility(), overviews: new Map([['char-1', OVERVIEW]]) },
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).querySelector('.hk-party__open')).toBeNull();
    });

    it('DM + never-saved settings: reads the server default "full" and offers "View sheet"', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
          settings: null,
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect(viewSheetButton(fixture.nativeElement as HTMLElement)).not.toBeNull();
    });

    it('DM + partySheets "overview" (not "full"): no "View sheet" button', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
          settings: {
            houseRules: { xpMode: 'xp' },
            visibility: { partySheets: 'overview', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        }),
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(viewSheetButton(compiled)).toBeNull();
    });

    it('a MEMBER (not DM) with partySheets "full": no "View sheet" button, even though the setting itself is "full"', async () => {
      configure({ role: 'player', state: stateWithFullVisibility() });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(viewSheetButton(compiled)).toBeNull();
    });
  });

  // plan-10 task-11-brief.md: doc-03 §bye obligation — scoped EXACTLY to a left:false roster
  // entry whose owning member has been removed/left the campaign.
  describe('DM unlink (doc-03 §bye obligation)', () => {
    function stateWithRemovedOwner(): Partial<CampaignState> {
      return mkState({
        members: new Map([['u-gone', { displayName: 'Charlie', role: 'player', removed: true }]]),
        roster: new Map([['char-1', { ownerId: 'u-gone', name: 'Grog', left: false }]]),
      });
    }

    /** The Unlink action lives in the leaf footer: select the member first, as a DM does. */
    function unlinkButton(compiled: HTMLElement): HTMLButtonElement | null {
      return (
        Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
          (b) => b.textContent?.trim() === 'Unlink character',
        ) ?? null
      );
    }

    function selectGrog(fixture: { detectChanges(): void }, compiled: HTMLElement): void {
      pressCard(compiled, 'Grog');
      fixture.detectChanges();
    }

    it('DM sees "Unlink character" on a left:false roster entry whose owner has been removed', async () => {
      configure({ role: 'dm', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(unlinkButton(compiled)).toBeNull();
      selectGrog(fixture, compiled);
      expect(unlinkButton(compiled)).not.toBeNull();
    });

    it('opens UnlinkCharacterDialogComponent with the ROSTER ownerId (not the DM) on click', async () => {
      const { dialogOpenSpy } = configure({ role: 'dm', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      selectGrog(fixture, compiled);
      unlinkButton(compiled)!.click();
      await fixture.whenStable();

      expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
      const [component, opts] = dialogOpenSpy.mock.calls[0] as [unknown, { data: unknown }];
      expect(component).toBe(UnlinkCharacterDialogComponent);
      expect(opts.data).toEqual({
        campaignId: '00000000-0000-4000-8000-000000000001',
        characterId: 'char-1',
        ownerId: 'u-gone',
        characterName: 'Grog',
      });
    });

    it('no unlink button when the owner is still an active (non-removed) member', async () => {
      configure({
        role: 'dm',
        state: mkState({
          members: new Map([['u-player', { displayName: 'Bob', role: 'player', removed: false }]]),
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx')).not.toBeNull();
      expect(unlinkButton(compiled)).toBeNull();
    });

    it('no unlink button once the roster entry itself already shows left:true', async () => {
      configure({
        role: 'dm',
        state: mkState({
          members: new Map([['u-gone', { displayName: 'Charlie', role: 'player', removed: true }]]),
          roster: new Map([['char-1', { ownerId: 'u-gone', name: 'Grog', left: true }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      selectGrog(fixture, compiled);
      expect(compiled.querySelector('.qfx')).toBeNull();
      expect(unlinkButton(compiled)).toBeNull();
    });

    it('a non-DM member never sees the unlink action, even for a removed owner', async () => {
      configure({ role: 'player', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      selectGrog(fixture, compiled);
      expect(unlinkButton(compiled)).toBeNull();
    });
  });

  // plan 17 B11b: card selection drives the quick-effects leaf (DM only) and the campaign strap.
  describe('card selection and the quick-effects leaf', () => {
    function twoCards(role: 'dm' | 'player' = 'dm') {
      configure({
        role,
        state: mkState({
          roster: new Map([
            ['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }],
            ['char-2', { ownerId: 'u-player', name: 'Grog', left: false }],
          ]),
          overviews: new Map([['char-1', OVERVIEW]]),
        }),
      });
      return TestBed.createComponent(PartyTabComponent);
    }

    it('pressing a DM card selects it for the strap, marks it, shows the leaf for it, and a second press clears it', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const selection = TestBed.inject(CampaignSelectionService);
      const marks = () =>
        Array.from(compiled.querySelectorAll('.party-tab__card')).map((c) =>
          c.getAttribute('data-selected'),
        );

      expect(compiled.querySelector('app-quick-effects-leaf')).toBeNull();
      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      expect(selection.selected()).toEqual({ characterId: 'char-1', name: 'Ivan' });
      expect(marks()).toEqual(['true', 'false']);
      expect(
        compiled.querySelector('app-quick-effects-leaf .hk-leaf__title-text')?.textContent,
      ).toBe('Ivan');

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      expect(selection.selected()).toBeNull();
      expect(compiled.querySelector('app-quick-effects-leaf')).toBeNull();
    });

    it('a focused DM card is a tab stop, and Enter or Space on it selects and clears like a press', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const selection = TestBed.inject(CampaignSelectionService);
      const card = compiled.querySelector<HTMLElement>('.party-tab__card')!;
      const key = (name: string, el: HTMLElement = card): void => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
        fixture.detectChanges();
      };

      expect(card.getAttribute('tabindex')).toBe('0');
      key('Enter');
      expect(selection.selected()?.characterId).toBe('char-1');
      expect(card.getAttribute('aria-current')).toBe('true');
      key(' ');
      expect(selection.selected()).toBeNull();
      // Enter on a control inside the card is that control's, not the card's.
      key('Enter', card.querySelector<HTMLElement>('[data-effect-chip="heal"]')!);
      expect(selection.selected()).toBeNull();
    });

    it('a player card is no tab stop and keys do nothing', async () => {
      const fixture = twoCards('player');
      await fixture.whenStable();
      const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.party-tab__card',
      )!;
      expect(card.getAttribute('tabindex')).toBeNull();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(TestBed.inject(CampaignSelectionService).selected()).toBeNull();
    });

    it("moves the leaf to another card's member when that card is pressed", async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      pressCard(compiled, 'Grog');
      fixture.detectChanges();
      expect(TestBed.inject(CampaignSelectionService).selected()?.characterId).toBe('char-2');
      expect(compiled.querySelectorAll('app-quick-effects-leaf')).toHaveLength(1);
      expect(
        compiled.querySelector('app-quick-effects-leaf .hk-leaf__title-text')?.textContent,
      ).toBe('Grog');
    });

    it("a press on a card's caption selects like the card, but a press on its own control does not toggle", async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const selection = TestBed.inject(CampaignSelectionService);

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      compiled
        .querySelector<HTMLElement>('.party-tab__card[data-selected="true"] .hk-party__sub')!
        .click();
      fixture.detectChanges();
      // The caption is not a control: it is a press on the card.
      expect(selection.selected()).toBeNull();
      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      compiled.querySelector<HTMLElement>('.party-tab__card [data-effect-chip="heal"]')!.click();
      fixture.detectChanges();
      expect(selection.selected()?.characterId).toBe('char-1');
    });

    it('each active DM card carries the effect chips (XP in XP mode), and a chip selects the card and shows that tab', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const card = compiled.querySelectorAll('.party-tab__card')[1];

      expect(
        Array.from(card.querySelectorAll('[data-effect-chip]')).map((c) =>
          c.getAttribute('data-effect-chip'),
        ),
      ).toEqual(['damage', 'heal', 'temp', 'condition', 'xp', 'item', 'inspiration', 'override']);

      card.querySelector<HTMLElement>('[data-effect-chip="heal"]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(TestBed.inject(CampaignSelectionService).selected()?.characterId).toBe('char-2');
      expect(
        compiled
          .querySelector('app-quick-effects-leaf [role="tabpanel"]')
          ?.getAttribute('data-effect'),
      ).toBe('heal');
    });

    it('offers a player no chips, no leaf and no selection', async () => {
      const fixture = twoCards('player');
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('[data-effect-chip]')).toBeNull();
      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      expect(TestBed.inject(CampaignSelectionService).selected()).toBeNull();
      expect(compiled.querySelector('app-quick-effects-leaf')).toBeNull();
    });

    it('never offers chips, selection or a leaf on a left:true card, even for the DM', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Departed', left: true }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('[data-effect-chip]')).toBeNull();
      pressCard(compiled, 'Departed');
      fixture.detectChanges();
      expect(TestBed.inject(CampaignSelectionService).selected()).toBeNull();
      expect(compiled.querySelector('app-quick-effects-leaf')).toBeNull();
    });

    it('a strap request for the selected member lands on its leaf, once', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const selection = TestBed.inject(CampaignSelectionService);

      pressCard(compiled, 'Grog');
      fixture.detectChanges();
      selection.requestEffect('item');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        compiled
          .querySelector('app-quick-effects-leaf [role="tabpanel"]')
          ?.getAttribute('data-effect'),
      ).toBe('item');
      expect(selection.request()).toBeNull();
    });

    it('closing the leaf clears the selection', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      compiled.querySelector<HTMLButtonElement>('.qfx__close')!.click();
      fixture.detectChanges();
      expect(TestBed.inject(CampaignSelectionService).selected()).toBeNull();
      expect(compiled.querySelector('app-quick-effects-leaf')).toBeNull();
    });

    it('the leaf gets the HP baseline of the overview, and none for a card with no overview yet', async () => {
      const fixture = twoCards();
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Ivan');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx__hint')?.textContent).toContain('8 / 12 HP');
      pressCard(compiled, 'Grog');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx__hint')?.textContent?.trim()).toBe('Quick effects');
    });

    // Carry (a) from B11a's review: a request that no leaf can ever take must not linger.
    describe('requests and selections no leaf can address', () => {
      it('drops a pending request addressed to a member who left the roster', async () => {
        configure({
          role: 'dm',
          state: mkState({
            roster: new Map([['char-1', { ownerId: 'u-player', name: 'Departed', left: true }]]),
          }),
        });
        const selection = TestBed.inject(CampaignSelectionService);
        selection.select({ characterId: 'char-1', name: 'Departed' });
        selection.requestEffect('damage');
        const fixture = TestBed.createComponent(PartyTabComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(selection.request()).toBeNull();
        expect(selection.selected()).toBeNull();
      });

      it('drops a pending request and selection for a member absent from the roster', async () => {
        configure({
          role: 'dm',
          state: mkState({
            roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
          }),
        });
        const selection = TestBed.inject(CampaignSelectionService);
        selection.select({ characterId: 'gone', name: 'Gone' });
        selection.requestEffect('heal');
        const fixture = TestBed.createComponent(PartyTabComponent);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(selection.request()).toBeNull();
        expect(selection.selected()).toBeNull();
      });

      it('keeps a request for a member who is on the roster until their leaf takes it', async () => {
        configure({
          role: 'dm',
          state: mkState({
            roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
          }),
        });
        const selection = TestBed.inject(CampaignSelectionService);
        selection.select({ characterId: 'char-1', name: 'Ivan' });
        selection.requestEffect('damage');
        const fixture = TestBed.createComponent(PartyTabComponent);
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(selection.selected()?.characterId).toBe('char-1');
        expect(selection.request()).toBeNull(); // taken by the leaf, not dropped
        expect(
          (fixture.nativeElement as HTMLElement)
            .querySelector('app-quick-effects-leaf [role="tabpanel"]')
            ?.getAttribute('data-effect'),
        ).toBe('damage');
      });
    });
  });

  // plan 17 B11b (board C07): the player's own hero is highlighted and opens its sheet.
  describe('presence on the cards', () => {
    const roster = new Map([
      ['char-1', { ownerId: 'u-a', name: 'Ivan', left: false }],
      ['char-2', { ownerId: 'u-b', name: 'Grog', left: false }],
    ]);
    const overviews = new Map([
      ['char-1', OVERVIEW],
      ['char-2', OVERVIEW],
    ]);
    const members = new Map([
      ['u-a', { displayName: 'Ann', role: 'player' as const, removed: false }],
      ['u-b', { displayName: 'Bob', role: 'player' as const, removed: false }],
    ]);
    const presenceOf = (compiled: HTMLElement): (string | undefined)[] =>
      Array.from(compiled.querySelectorAll('.party-tab__card')).map((card) =>
        card.querySelector('.hk-party__presence')?.textContent?.trim(),
      );

    it("says online or offline on each card from its owner's live presence, as the lobby does", async () => {
      configure({
        role: 'dm',
        state: mkState({ roster, overviews, members }),
        live: [
          { userId: 'u-a', displayName: 'Ann', role: 'member', online: true },
          { userId: 'u-b', displayName: 'Bob', role: 'member', online: false },
        ],
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect(presenceOf(fixture.nativeElement as HTMLElement)).toEqual(['Online', 'Offline']);
    });

    it('draws nothing while there is no live member list (presence unknown)', async () => {
      configure({ role: 'dm', state: mkState({ roster, overviews, members }), live: null });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect(presenceOf(fixture.nativeElement as HTMLElement)).toEqual([undefined, undefined]);
    });

    it('reads an owner missing from the live list as offline', async () => {
      configure({
        role: 'player',
        state: mkState({ roster, overviews, members }),
        live: [{ userId: 'u-a', displayName: 'Ann', role: 'member', online: true }],
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect(presenceOf(fixture.nativeElement as HTMLElement)).toEqual(['Online', 'Offline']);
    });
  });

  describe('the player view', () => {
    function ownAndOther() {
      return mkState({
        members: new Map([
          ['u-player', { displayName: 'Bob', role: 'player', removed: false }],
          ['u-other', { displayName: 'Cy', role: 'player', removed: false }],
        ]),
        roster: new Map([
          ['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }],
          ['char-2', { ownerId: 'u-other', name: 'Grog', left: false }],
        ]),
      });
    }

    it('marks the viewer\'s own hero with a "Your hero" plate and an Open my sheet button that opens it', async () => {
      const { navigateSpy } = configure({
        role: 'player',
        userId: 'u-player',
        state: ownAndOther(),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const [own, other] = Array.from(compiled.querySelectorAll('.party-tab__card'));
      expect(own.getAttribute('data-mine')).toBe('true');
      expect(own.querySelector('.party-tab__mine-badge')?.textContent?.trim()).toBe('Your hero');
      expect(other.getAttribute('data-mine')).toBe('false');
      expect(other.querySelector('.party-tab__mine-badge')).toBeNull();
      expect(other.querySelector('.party-tab__open-mine')).toBeNull();

      own.querySelector<HTMLButtonElement>('.party-tab__open-mine')!.click();
      expect(navigateSpy).toHaveBeenCalledWith(['/c', 'char-1']);
    });

    it('shows the DM no "Your hero" plate on a hero they do not own', async () => {
      configure({ role: 'dm', userId: 'u-dm', state: ownAndOther() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.party-tab__mine-badge'),
      ).toBeNull();
    });
  });

  // plan-10 task-12-brief.md: pregens + claiming (ruling 6). A pregen has NO protocol flag — it is
  // derived purely from the roster's own `ownerId` matching the campaign's DM (`state.members`,
  // `role: 'dm'`).
  describe('pregens (DM-owned rostered characters) + handover', () => {
    function stateWithPregen(overrides: Partial<CampaignState> = {}): Partial<CampaignState> {
      return mkState({
        members: new Map([
          ['u-dm', { displayName: 'Gary', role: 'dm', removed: false }],
          ['u-alice', { displayName: 'Alice', role: 'player', removed: false }],
        ]),
        roster: new Map([['char-1', { ownerId: 'u-dm', name: 'Pregen Paul', left: false }]]),
        ...overrides,
      });
    }

    it('the DM sees an "Add pregen" button that navigates to the create wizard with a returnUrl back to link-character', async () => {
      const { navigateSpy } = configure({ role: 'dm', state: stateWithPregen() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const button = compiled.querySelector<HTMLButtonElement>('.party-tab__add-pregen');
      expect(button).not.toBeNull();
      button!.click();

      expect(navigateSpy).toHaveBeenCalledWith(['/characters/new'], {
        queryParams: { returnUrl: '/g/00000000-0000-4000-8000-000000000001/link-character' },
      });
    });

    it('a non-DM member never sees the "Add pregen" button', async () => {
      configure({ role: 'player', state: stateWithPregen() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__add-pregen')).toBeNull();
    });

    it('a roster card whose ownerId is the campaign DM shows the pregen badge; an ordinary member-owned card does not', async () => {
      configure({
        role: 'player',
        state: stateWithPregen({
          roster: new Map([
            ['char-1', { ownerId: 'u-dm', name: 'Pregen Paul', left: false }],
            ['char-2', { ownerId: 'u-alice', name: 'Alice PC', left: false }],
          ]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const cards = Array.from(compiled.querySelectorAll('.party-tab__card'));
      const pregenCard = cards.find((c) => c.textContent?.includes('Pregen Paul'))!;
      const aliceCard = cards.find((c) => c.textContent?.includes('Alice PC'))!;
      expect(pregenCard.querySelector('.party-tab__pregen-badge')).not.toBeNull();
      expect(aliceCard.querySelector('.party-tab__pregen-badge')).toBeNull();
    });

    it('the DM sees "Hand over to…" on their OWN pregen card, and it opens HandoverCharacterDialogComponent with the right data', async () => {
      const { dialogOpenSpy } = configure({ role: 'dm', state: stateWithPregen() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.qfx__handover')).toBeNull();
      pressCard(compiled, 'Pregen Paul');
      fixture.detectChanges();
      const button = compiled.querySelector<HTMLButtonElement>('.qfx__handover');
      expect(button).not.toBeNull();
      button!.click();
      await fixture.whenStable();

      expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
      const [component, opts] = dialogOpenSpy.mock.calls[0] as [unknown, { data: unknown }];
      expect(component).toBe(HandoverCharacterDialogComponent);
      expect(opts.data).toEqual({
        campaignId: '00000000-0000-4000-8000-000000000001',
        characterId: 'char-1',
        characterName: 'Pregen Paul',
        fromOwnerId: 'u-dm',
      });
    });

    it('a non-DM member never sees "Hand over to…", even on the pregen card', async () => {
      configure({ role: 'player', state: stateWithPregen() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Pregen Paul');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx__handover')).toBeNull();
    });

    it('the DM never sees "Hand over to…" on an ordinary MEMBER-owned card (not a pregen)', async () => {
      configure({
        role: 'dm',
        state: stateWithPregen({
          roster: new Map([['char-2', { ownerId: 'u-alice', name: 'Alice PC', left: false }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Alice PC');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx')).not.toBeNull();
      expect(compiled.querySelector('.qfx__handover')).toBeNull();
    });

    it('the DM never sees "Hand over to…" on a pregen that has already LEFT the roster', async () => {
      configure({
        role: 'dm',
        state: stateWithPregen({
          roster: new Map([['char-1', { ownerId: 'u-dm', name: 'Pregen Paul', left: true }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      pressCard(compiled, 'Pregen Paul');
      fixture.detectChanges();
      expect(compiled.querySelector('.qfx')).toBeNull();
      expect(compiled.querySelector('.qfx__handover')).toBeNull();
    });
  });

  describe('encounter plate (plan 18 task 2)', () => {
    const plate = (c: HTMLElement) => c.querySelector<HTMLElement>('.encounter-plate')!;
    const named = (c: HTMLElement, label: string) =>
      Array.from(plate(c).querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === label,
      );

    it('shows "No encounter" with Start encounter for the DM, and Start calls the store', async () => {
      configure({ role: 'dm' });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(plate(compiled).textContent).toContain(campaignsEn.encounter.none);
      named(compiled, campaignsEn.encounter.start)!.click();
      expect(encounterSpies.start).toHaveBeenCalled();
      expect(named(compiled, campaignsEn.encounter.advance)).toBeUndefined();
    });

    it('shows "Encounter 2 · Round 3" with Advance round and End encounter while one is open', async () => {
      configure({ role: 'dm', encounter: { id: 'e2', round: 3, number: 2 } });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(plate(compiled).textContent).toContain('Encounter 2 · Round 3');
      named(compiled, campaignsEn.encounter.advance)!.click();
      expect(encounterSpies.advance).toHaveBeenCalled();
      await fixture.whenStable();
      named(compiled, campaignsEn.encounter.end)!.click();
      expect(encounterSpies.end).toHaveBeenCalled();
      expect(named(compiled, campaignsEn.encounter.start)).toBeUndefined();
    });

    it('gives a player the reading without the controls', async () => {
      configure({ role: 'player', encounter: { id: 'e2', round: 3, number: 2 } });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(plate(compiled).textContent).toContain('Encounter 2 · Round 3');
      expect(plate(compiled).querySelectorAll('button')).toHaveLength(0);
    });
  });
});
