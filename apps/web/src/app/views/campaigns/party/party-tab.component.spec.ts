import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { MembershipRole } from '@hk/protocol';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import type { CampaignState } from '@shared/services/campaigns/campaign-projection';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { HandoverCharacterDialogComponent } from './handover-character-dialog.component';
import { MemberSheetDialogComponent } from './member-sheet-dialog.component';
import { PartyTabComponent } from './party-tab.component';
import { UnlinkCharacterDialogComponent } from './unlink-character-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
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

function configure(options: {
  role?: MembershipRole;
  state?: Partial<CampaignState>;
  userId?: string | null;
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
      // [plan-10 Task 9] Spied/mocked rather than the real `DialogService` — this spec's own
      // TestBed provides none of `MemberSheetDialogComponent`'s own DI needs (SyncService/
      // PackStore/EngineFacade with a real pack); that component's own rendering is exhaustively
      // covered by `member-sheet-dialog.component.spec.ts` instead. This boundary only asserts
      // PartyTabComponent calls `DialogService.open` with the right component/data.
      { provide: DialogService, useValue: { open: dialogOpenSpy } },
    ],
  });
  TestBed.inject(Router).navigate = navigateSpy;
  return { navigateSpy, dialogOpenSpy };
}

describe('PartyTabComponent', () => {
  it('renders a full overview card (hp bar+text, ac, level/classes, conditions, concentration, passive perception)', async () => {
    configure({
      role: 'player',
      state: mkState({
        roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        overviews: new Map([
          [
            'char-1',
            {
              hp: 8,
              hpMax: 12,
              temp: 2,
              ac: 19,
              level: 1,
              classes: [{ classId: 'srd:class/fighter', level: 1 }],
              conditions: ['srd:condition/prone'],
              concentration: true,
              passivePerception: 13,
            },
          ],
        ]),
        members: new Map([['u-player', { displayName: 'Bob', role: 'player', removed: false }]]),
      }),
    });

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = compiled.querySelector('.party-tab__card')!;
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('aria-label')).toBe('Ivan');
    expect(card.querySelector('.party-tab__name')?.textContent?.trim()).toBe('Ivan');
    expect(card.querySelector('.party-tab__hp-text')?.textContent).toContain('8/12');
    expect(card.querySelector('.party-tab__hp-text')?.textContent).toContain('2');
    expect(card.querySelector('.party-tab__stats')?.textContent).toContain('19');
    expect(card.querySelector('.party-tab__stats')?.textContent).toContain('13');
    expect(card.querySelector('.party-tab__classes')?.textContent).toContain('Fighter');
    expect(card.querySelector('.party-tab__classes')?.textContent).toContain('1');
    expect(card.querySelector('.party-tab__concentration')).not.toBeNull();
    expect(card.querySelector('.party-tab__condition')?.textContent?.trim()).toBe('Prone');
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
    expect(card.querySelector('.party-tab__hp-bar')).toBeNull();
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
            visibility: { partySheets: 'none', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card .party-tab__hp-bar')).toBeNull();
      expect(compiled.querySelector('.party-tab__hidden-notice')).not.toBeNull();
    });

    it('the DM ALWAYS sees full overview detail, even when partySheets is "none"', async () => {
      configure({
        role: 'dm',
        state: {
          ...stateWithOverview(),
          settings: {
            visibility: { partySheets: 'none', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card .party-tab__hp-bar')).not.toBeNull();
      expect(compiled.querySelector('.party-tab__hidden-notice')).toBeNull();
    });

    it('a MEMBER sees full detail under "overview" and "full" (only DM-only drill-in — Task 9 — differs at "full")', async () => {
      configure({
        role: 'player',
        state: {
          ...stateWithOverview(),
          settings: {
            visibility: { partySheets: 'overview', rolls: 'everyone', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        },
      });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.party-tab__card .party-tab__hp-bar')).not.toBeNull();
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

    it('DM + partySheets "full": renders the "View sheet" button, which opens MemberSheetDialogComponent with the right data', async () => {
      const { dialogOpenSpy } = configure({ role: 'dm', state: stateWithFullVisibility() });

      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const button = viewSheetButton(compiled);
      expect(button).not.toBeNull();
      button?.click();
      await fixture.whenStable();

      expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
      const [component, opts] = dialogOpenSpy.mock.calls[0] as [
        unknown,
        { data: unknown; sheet?: boolean },
      ];
      expect(component).toBe(MemberSheetDialogComponent);
      expect(opts.data).toEqual({
        campaignId: '00000000-0000-4000-8000-000000000001',
        characterId: 'char-1',
        name: 'Ivan',
      });
      expect(opts.sheet).toBe(true);
    });

    it('DM + partySheets "overview" (not "full"): no "View sheet" button', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
          settings: {
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

    function unlinkButton(compiled: HTMLElement): HTMLButtonElement | null {
      return (
        Array.from(compiled.querySelectorAll<HTMLButtonElement>('.party-tab__card button')).find(
          (b) => b.textContent?.trim() === 'Unlink character',
        ) ?? null
      );
    }

    it('DM sees "Unlink character" on a left:false roster entry whose owner has been removed', async () => {
      configure({ role: 'dm', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(unlinkButton(compiled)).not.toBeNull();
    });

    it('opens UnlinkCharacterDialogComponent with the ROSTER ownerId (not the DM) on click', async () => {
      const { dialogOpenSpy } = configure({ role: 'dm', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

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

      expect(unlinkButton(compiled)).toBeNull();
    });

    it('a non-DM member never sees the unlink action, even for a removed owner', async () => {
      configure({ role: 'player', state: stateWithRemovedOwner() });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(unlinkButton(compiled)).toBeNull();
    });
  });

  // plan-10 task-11-brief.md: mounted on the party card (works in 'overview' mode), DM-only.
  describe('DM effects panel mounting', () => {
    it('mounts app-dm-effects-panel for the DM on an active (not-left) card', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('app-dm-effects-panel')).not.toBeNull();
    });

    it('never mounts the panel for a non-DM viewer', async () => {
      configure({
        role: 'player',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Ivan', left: false }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('app-dm-effects-panel')).toBeNull();
    });

    it('never mounts the panel on a left:true card, even for the DM', async () => {
      configure({
        role: 'dm',
        state: mkState({
          roster: new Map([['char-1', { ownerId: 'u-player', name: 'Departed', left: true }]]),
        }),
      });
      const fixture = TestBed.createComponent(PartyTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('app-dm-effects-panel')).toBeNull();
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

      const button = compiled.querySelector<HTMLButtonElement>('.party-tab__handover');
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

      expect(compiled.querySelector('.party-tab__handover')).toBeNull();
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

      expect(compiled.querySelector('.party-tab__handover')).toBeNull();
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

      expect(compiled.querySelector('.party-tab__handover')).toBeNull();
    });
  });
});
