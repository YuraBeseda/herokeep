import { Component, inject, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CampaignSettings, Event } from '@hk/protocol';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import type { CampaignState, MemberEntry } from './campaign-projection';
import {
  CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS,
  campaignEditLockFromState,
  CampaignEditLockService,
} from './campaign-edit-lock';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'usr_member0000000000000001';
const DM_ID = 'usr_dm00000000000000000001';

function mkState(overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    settings: null,
    members: new Map<string, MemberEntry>(),
    roster: new Map(),
    packs: new Map(),
    overviews: new Map(),
    session: { active: false },
    log: [],
    dmNotes: new Map(),
    archived: false,
    ...overrides,
  };
}

function settingsWith(
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

function memberState(role: 'dm' | 'player'): CampaignState {
  return mkState({
    settings: settingsWith('locked'),
    members: new Map([[USER_ID, { displayName: 'Bob', role, removed: false }]]),
  });
}

// --- Pure function: the full ruling-7 matrix ------------------------------------------------

describe('campaignEditLockFromState — ruling 7 (edit-outside-session) matrix', () => {
  it('never locks when there is no campaign context at all (solo character)', () => {
    expect(campaignEditLockFromState(null, USER_ID)).toEqual({ locked: false });
  });

  it('defaults editOutsideSession to "free" when no settings document has been posted yet', () => {
    const state = mkState({
      members: new Map([[USER_ID, { displayName: 'Bob', role: 'player', removed: false }]]),
      session: { active: false },
    });
    expect(campaignEditLockFromState(state, USER_ID)).toEqual({ locked: false });
  });

  const rules: readonly CampaignSettings['houseRules']['editOutsideSession'][] = [
    'free',
    'dmApproval',
    'locked',
  ];
  const sessionActiveValues = [true, false];
  const roles: readonly ('member' | 'dm')[] = ['member', 'dm'];

  for (const rule of rules) {
    for (const active of sessionActiveValues) {
      for (const role of roles) {
        const expectedLocked = role === 'member' && rule !== 'free' && !active;
        it(`rule=${rule} session.active=${active} role=${role} -> locked=${expectedLocked}`, () => {
          const state = mkState({
            settings: settingsWith(rule),
            session: { active },
            members: new Map([
              [
                USER_ID,
                { displayName: 'Bob', role: role === 'dm' ? 'dm' : 'player', removed: false },
              ],
            ]),
          });
          const result = campaignEditLockFromState(state, USER_ID);
          expect(result.locked).toBe(expectedLocked);
          if (expectedLocked) {
            expect(result.mode).toBe(rule === 'dmApproval' ? 'dmApprovalV1' : 'locked');
          } else {
            expect(result.mode).toBeUndefined();
          }
        });
      }
    }
  }

  it('DM is exempt even while the session is inactive and the rule is "locked"', () => {
    expect(campaignEditLockFromState(memberState('dm'), USER_ID)).toEqual({ locked: false });
  });

  it('an ordinary member IS locked under the same conditions the DM is exempt from', () => {
    expect(campaignEditLockFromState(memberState('player'), USER_ID)).toEqual({
      locked: true,
      mode: 'locked',
    });
  });

  it('a userId not present in state.members at all is treated as an ordinary (non-DM) member', () => {
    const state = mkState({ settings: settingsWith('locked'), session: { active: false } });
    expect(campaignEditLockFromState(state, 'usr_stranger00000000000001')).toEqual({
      locked: true,
      mode: 'locked',
    });
  });

  it('an undefined userId (no signed-in user resolved yet) is never DM-exempt', () => {
    const state = mkState({ settings: settingsWith('locked'), session: { active: false } });
    expect(campaignEditLockFromState(state, undefined)).toEqual({ locked: true, mode: 'locked' });
  });

  it('dmApproval renders as the DISTINCT dmApprovalV1 mode, not the plain "locked" mode (OWNER-FLAG: v1 has no approval queue)', () => {
    const state = mkState({
      settings: settingsWith('dmApproval'),
      session: { active: false },
      members: new Map([[USER_ID, { displayName: 'Bob', role: 'player', removed: false }]]),
    });
    expect(campaignEditLockFromState(state, USER_ID)).toEqual({
      locked: true,
      mode: 'dmApprovalV1',
    });
  });
});

// --- CampaignEditLockService: the reactive, cross-stream read half --------------------------

const POLL_MS = 15;
async function waitPastPoll(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS + 60));
}

function campaignJoinedEvent(streamId: string, campaignId: string): Event {
  return {
    id: 'evt-joined-1',
    stream: streamId,
    ts: '2026-01-01T00:00:00.000Z',
    actor: { userId: USER_ID, deviceId: 'device-1', role: 'owner' },
    type: 'character.campaign_joined',
    v: 1,
    payload: { campaignId },
  } as unknown as Event;
}

function campaignEvent(
  type: string,
  payload: unknown,
  actorUserId: string,
  role: 'dm' | 'member',
): Event {
  return {
    id: `evt-${type}-${Math.random().toString(36).slice(2)}`,
    stream: `camp:${CAMPAIGN_ID}`,
    ts: '2026-01-01T00:00:00.000Z',
    actor: { userId: actorUserId, deviceId: 'device-1', role },
    type,
    v: 1,
    payload,
  };
}

@Component({ selector: 'app-test-edit-lock-host', template: '' })
class TestEditLockHostComponent {
  private readonly service = inject(CampaignEditLockService);
  readonly characterEvents: WritableSignal<Event[]> = signal([]);
  readonly editLock = this.service.editLockFor(this.characterEvents);
}

function configure(): { userState: WritableSignal<AuthUser | null> } {
  const userState = signal<AuthUser | null>({ userId: USER_ID, username: 'Bob' });
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: userState } },
      { provide: CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS, useValue: POLL_MS },
    ],
  });
  return { userState };
}

describe('CampaignEditLockService.editLockFor', () => {
  beforeEach(async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await Promise.all([db.events.clear(), db.settings.clear()]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('is unlocked and reads no campaign stream at all for a solo (never-linked) character', async () => {
    const fixture = TestBed.createComponent(TestEditLockHostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.editLock()).toEqual({ locked: false });
  });

  it('resolves locked:true for a campaign-linked member once the campaign events (locked rule, no session) sync down', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    await eventsRepository.append([
      campaignEvent('campaign.settings_changed', { settings: settingsWith('locked') }, DM_ID, 'dm'),
      campaignEvent(
        'member.joined',
        { userId: USER_ID, displayName: 'Bob', role: 'player' },
        USER_ID,
        'member',
      ),
    ]);

    const fixture = TestBed.createComponent(TestEditLockHostComponent);
    fixture.componentInstance.characterEvents.set([campaignJoinedEvent('char:c1', CAMPAIGN_ID)]);
    await fixture.whenStable();

    expect(fixture.componentInstance.editLock()).toEqual({ locked: true, mode: 'locked' });
  });

  it('is exempt for the campaign\'s own DM even under the "locked" rule with no active session', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    await eventsRepository.append([
      campaignEvent('campaign.settings_changed', { settings: settingsWith('locked') }, DM_ID, 'dm'),
      campaignEvent(
        'member.joined',
        { userId: USER_ID, displayName: 'Bob', role: 'dm' },
        USER_ID,
        'dm',
      ),
    ]);

    const fixture = TestBed.createComponent(TestEditLockHostComponent);
    fixture.componentInstance.characterEvents.set([campaignJoinedEvent('char:c1', CAMPAIGN_ID)]);
    await fixture.whenStable();

    expect(fixture.componentInstance.editLock()).toEqual({ locked: false });
  });

  it('unlocks once session.started lands, and does not require a characterEvents change to notice it (bounded poll)', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    await eventsRepository.append([
      campaignEvent('campaign.settings_changed', { settings: settingsWith('locked') }, DM_ID, 'dm'),
      campaignEvent(
        'member.joined',
        { userId: USER_ID, displayName: 'Bob', role: 'player' },
        USER_ID,
        'member',
      ),
    ]);

    const fixture = TestBed.createComponent(TestEditLockHostComponent);
    fixture.componentInstance.characterEvents.set([campaignJoinedEvent('char:c1', CAMPAIGN_ID)]);
    await fixture.whenStable();
    expect(fixture.componentInstance.editLock().locked).toBe(true);

    // A session starts on ANOTHER device — this device's own always-on campaign session (T5) syncs
    // it down into the same local `camp:<id>` event rows this service reads; nothing here changes
    // `characterEvents` at all.
    await eventsRepository.append([
      campaignEvent('session.started', { title: 'Session 4' }, DM_ID, 'dm'),
    ]);
    await waitPastPoll();
    await fixture.whenStable();

    expect(fixture.componentInstance.editLock()).toEqual({ locked: false });
  });

  it('re-resolves against the NEW campaign when characterEvents switches to a different campaign link', async () => {
    const otherCampaignId = '22222222-2222-4222-8222-222222222222';
    const eventsRepository = TestBed.inject(EventsRepository);
    await eventsRepository.append([
      campaignEvent('campaign.settings_changed', { settings: settingsWith('locked') }, DM_ID, 'dm'),
      campaignEvent(
        'member.joined',
        { userId: USER_ID, displayName: 'Bob', role: 'player' },
        USER_ID,
        'member',
      ),
    ]);
    await eventsRepository.append([
      {
        id: 'evt-other-settings',
        stream: `camp:${otherCampaignId}`,
        ts: '2026-01-01T00:00:00.000Z',
        actor: { userId: DM_ID, deviceId: 'device-1', role: 'dm' },
        type: 'campaign.settings_changed',
        v: 1,
        payload: { settings: settingsWith('free') },
      } as unknown as Event,
    ]);

    const fixture = TestBed.createComponent(TestEditLockHostComponent);
    fixture.componentInstance.characterEvents.set([campaignJoinedEvent('char:c1', CAMPAIGN_ID)]);
    await fixture.whenStable();
    expect(fixture.componentInstance.editLock().locked).toBe(true);

    fixture.componentInstance.characterEvents.set([
      campaignJoinedEvent('char:c1', otherCampaignId),
    ]);
    await fixture.whenStable();

    expect(fixture.componentInstance.editLock()).toEqual({ locked: false });
  });
});
