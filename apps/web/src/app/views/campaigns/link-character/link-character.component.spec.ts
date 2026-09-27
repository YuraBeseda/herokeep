import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { Event } from '@hk/protocol';
import type { AuthUser } from '@shared/services/auth/auth.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import {
  CharacterStore,
  CharacterStoreNotLeaderError,
  type DraftEvent,
} from '@shared/stores/character.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { LinkCharacterComponent } from './link-character.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000b2';
const OWNER_ID = 'usr_owner1';
const CHAR_A = 'char:00000000-0000-4000-8000-0000000000c1';
const CHAR_B = 'char:00000000-0000-4000-8000-0000000000c2';
const CHAR_C = 'char:00000000-0000-4000-8000-0000000000c3';
const CHAR_D = 'char:00000000-0000-4000-8000-0000000000c4';
const CHAR_E = 'char:00000000-0000-4000-8000-0000000000c5';

interface RosterEntryStub {
  readonly ownerId: string;
  readonly name: string;
  readonly left: boolean;
}

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

let nextId = 1;
function freshId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

function mkRow(id: string, name: string, archived = false): CharacterRow {
  return { id, name, system: 'srd-5e-2024', archived, updatedAt: 1 };
}

function mkEvent(type: string, payload: unknown, stream: string, seq?: number, id?: string): Event {
  return {
    id: id ?? freshId(),
    stream,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: OWNER_ID, deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

/** Commits every appended draft INSTANTLY (a `seq` is present from the very first write) — the
 * happy-path fake: `appendAndAwaitAck`'s first poll tick already sees it committed, so tests using
 * this never wait on a real timer. `initialEvents` seeds the port as though `CharacterStore.load()`
 * had already replayed this character's real storage — needed for a resume/resumeLeave test,
 * where `runAttempt` re-derives step (a)'s state from THIS signal post-load, not from
 * `eventsByCharacter` (a separate, `EventsRepository`-only snapshot feeding the picker's own
 * eligibility badge). */
function instantCommitPort(
  streamId: string,
  initialEvents: Event[] = [],
): {
  events: WritableSignal<Event[]>;
  appendTx: ReturnType<typeof vi.fn>;
} {
  const events = signal<Event[]>(initialEvents);
  let seq = initialEvents.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
  const appendTx = vi.fn((drafts: DraftEvent[]): Promise<void> => {
    const draft = drafts[0];
    events.set([...events(), mkEvent(draft.type, draft.payload, streamId, seq++)]);
    return Promise.resolve();
  });
  return { events, appendTx };
}

/** The FIRST call writes a pending event then rejects it (removes it) ~10ms later — real,
 * short-lived timer, well under `awaitEventSettled`'s default 25ms poll interval's own next tick.
 * Every SUBSEQUENT call (a retry) commits instantly, like `instantCommitPort`. */
function rejectOnceThenCommitPort(streamId: string): {
  events: WritableSignal<Event[]>;
  appendTx: ReturnType<typeof vi.fn>;
} {
  const events = signal<Event[]>([]);
  let seq = 1;
  let calls = 0;
  const appendTx = vi.fn((drafts: DraftEvent[]): Promise<void> => {
    calls++;
    const draft = drafts[0];
    const event = mkEvent(draft.type, draft.payload, streamId);
    events.set([...events(), event]);
    if (calls === 1) {
      setTimeout(() => {
        events.set(events().filter((e) => e.id !== event.id));
      }, 10);
    } else {
      events.set(events().map((e) => (e.id === event.id ? { ...e, seq: seq++ } : e)));
    }
    return Promise.resolve();
  });
  return { events, appendTx };
}

function configure(options: {
  rows?: CharacterRow[];
  eventsByCharacter?: Record<string, Event[]>;
  syncStates?: Record<string, string>;
  characterPort?: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignPort?: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  characterLoad?: ReturnType<typeof vi.fn>;
  user?: AuthUser | null;
  /** Bare characterId -> roster entry — fix round 1, finding 1's `resumeLeave` detection reads
   * `CampaignStore.state()?.roster`. */
  roster?: Record<string, RosterEntryStub>;
}): {
  characterPort: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignPort: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  characterLoad: ReturnType<typeof vi.fn>;
} {
  const rows = options.rows ?? [mkRow(CHAR_A, 'Aria')];
  const eventsByCharacter = options.eventsByCharacter ?? {};
  const syncStates = options.syncStates ?? {};
  const characterPort = options.characterPort ?? instantCommitPort(CHAR_A);
  const campaignPort = options.campaignPort ?? instantCommitPort(`camp:${CAMPAIGN_ID}`);
  const characterLoad = options.characterLoad ?? vi.fn().mockResolvedValue(undefined);
  const user = options.user === undefined ? { userId: OWNER_ID, username: 'alice' } : options.user;
  const roster = new Map(Object.entries(options.roster ?? {}));

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
      {
        provide: CampaignStore,
        useValue: {
          campaignId: signal(CAMPAIGN_ID),
          state: signal({ roster }),
          events: campaignPort.events.asReadonly(),
          appendTx: campaignPort.appendTx,
        },
      },
      {
        provide: CharacterStore,
        useValue: {
          load: characterLoad,
          events: characterPort.events.asReadonly(),
          appendTx: characterPort.appendTx,
        },
      },
      { provide: CharactersRepository, useValue: { list: vi.fn().mockResolvedValue(rows) } },
      {
        provide: EventsRepository,
        useValue: {
          byStream: vi.fn((id: string) => Promise.resolve(eventsByCharacter[id] ?? [])),
        },
      },
      {
        provide: SyncService,
        useValue: { syncState: (id: string) => signal(syncStates[id] ?? 'synced') },
      },
      { provide: AuthService, useValue: { user: signal(user) } },
    ],
  });

  return { characterPort, campaignPort, characterLoad };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

describe('LinkCharacterComponent', () => {
  it('lists eligible SYNCED, unlinked characters with a "link this character" action', async () => {
    configure({ rows: [mkRow(CHAR_A, 'Aria')] });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Aria');
    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('eligible');
    expect(rowEl.querySelector('.link-character__pick')).toBeTruthy();
  });

  it('excludes archived characters entirely', async () => {
    configure({ rows: [mkRow(CHAR_A, 'Aria'), mkRow(CHAR_B, 'Old Ghost', true)] });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Aria');
    expect(compiled.textContent).not.toContain('Old Ghost');
  });

  it('shows a character already linked to ANOTHER campaign as non-selectable', async () => {
    configure({
      rows: [mkRow(CHAR_B, 'Borin')],
      eventsByCharacter: {
        [CHAR_B]: [
          mkEvent('character.campaign_joined', { campaignId: OTHER_CAMPAIGN_ID }, CHAR_B, 1),
        ],
      },
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('linkedElsewhere');
    expect(rowEl.querySelector('.link-character__pick')).toBeNull();
    expect(rowEl.querySelector('.link-character__resume')).toBeNull();
    expect(compiled.textContent).toContain(campaignsEn.link.linkedElsewhere);
  });

  it('shows a NOT-YET-SYNCED character with an explanatory CTA to the characters list', async () => {
    configure({ rows: [mkRow(CHAR_C, 'Caelan')], syncStates: { [CHAR_C]: 'offline' } });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('notSynced');
    expect(compiled.textContent).toContain(campaignsEn.link.notSynced);

    rowEl.querySelector<HTMLButtonElement>('.link-character__sync-cta')!.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/characters']);
  });

  it('a character ALREADY linked to THIS campaign shows "resume" and, on click, sends ONLY step (b)', async () => {
    const joinedEvent = mkEvent(
      'character.campaign_joined',
      { campaignId: CAMPAIGN_ID },
      CHAR_D,
      1,
    );
    const characterPort = instantCommitPort(CHAR_D, [joinedEvent]);
    const { campaignPort, characterLoad } = configure({
      rows: [mkRow(CHAR_D, 'Dara')],
      eventsByCharacter: { [CHAR_D]: [joinedEvent] },
      characterPort,
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('resume');
    const resumeButton = rowEl.querySelector<HTMLButtonElement>('.link-character__resume')!;
    expect(resumeButton).toBeTruthy();

    resumeButton.click();
    await whenStable(fixture);

    // Fix round 1, finding 2: resume now ALWAYS loads the character first — `retryCampaignLinkStepB`
    // needs a LIVE `events()` signal to verify/await step (a)'s commit state, not a stale snapshot.
    expect(characterLoad).toHaveBeenCalledWith(CHAR_D);
    expect(characterPort.appendTx).not.toHaveBeenCalled(); // step (a) is never RE-sent
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    const drafts = campaignPort.appendTx.mock.calls[0][0] as DraftEvent[];
    const draft = drafts[0];
    expect(draft.type).toBe('campaign.character_joined');
    expect(draft.payload).toEqual({
      characterId: CHAR_D.slice('char:'.length),
      ownerId: OWNER_ID,
      name: 'Dara',
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
  });

  // Fix round 1, finding 1: a LEAVE dialog dismissed (or its tab closed) between step (a)
  // committing and step (b) landing strands the character in a half-left state — the char-side
  // link is already gone (so the sheet's own chip disappears), but the campaign's roster still
  // shows the character active. This is the ONLY place that stuck state is ever discoverable again.
  it('a character stuck HALF-LEFT (roster still active, char-side already left) shows "resumeLeave", and finishing it sends ONLY campaign.character_left', async () => {
    const leftEvent = mkEvent('character.campaign_left', { campaignId: CAMPAIGN_ID }, CHAR_E, 1);
    const characterPort = instantCommitPort(CHAR_E, [leftEvent]);
    const { campaignPort, characterLoad } = configure({
      rows: [mkRow(CHAR_E, 'Elara')],
      eventsByCharacter: { [CHAR_E]: [leftEvent] },
      characterPort,
      roster: { [CHAR_E.slice('char:'.length)]: { ownerId: OWNER_ID, name: 'Elara', left: false } },
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('resumeLeave');
    const finishButton = rowEl.querySelector<HTMLButtonElement>('.link-character__resume-leave')!;
    expect(finishButton).toBeTruthy();

    finishButton.click();
    await whenStable(fixture);

    expect(characterLoad).toHaveBeenCalledWith(CHAR_E);
    expect(characterPort.appendTx).not.toHaveBeenCalled(); // step (a) is never re-sent
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    const drafts = campaignPort.appendTx.mock.calls[0][0] as DraftEvent[];
    expect(drafts[0].type).toBe('campaign.character_left');
    expect(drafts[0].payload).toEqual({
      characterId: CHAR_E.slice('char:'.length),
      ownerId: OWNER_ID,
      name: 'Elara',
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
  });

  it('a roster entry belonging to ANOTHER owner is not treated as a stuck leave for me', async () => {
    const leftEvent = mkEvent('character.campaign_left', { campaignId: CAMPAIGN_ID }, CHAR_E, 1);
    configure({
      rows: [mkRow(CHAR_E, 'Elara')],
      eventsByCharacter: { [CHAR_E]: [leftEvent] },
      characterPort: instantCommitPort(CHAR_E, [leftEvent]),
      roster: {
        [CHAR_E.slice('char:'.length)]: { ownerId: 'usr_someone_else', name: 'Elara', left: false },
      },
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    // Not linked to THIS campaign (char-side already left) and not a stuck-leave case either
    // (roster ownerId mismatch) — falls through to plain 'eligible', not 'resumeLeave'.
    const rowEl = compiled.querySelector('.link-character__row')!;
    expect(rowEl.getAttribute('data-eligibility')).toBe('eligible');
  });

  // Fix round 1, finding 3: a thrown exception (e.g. NotLeaderError) before ANY step is ever
  // recorded must still leave the user a way back in — not a dead-end generic error banner.
  it('a thrown exception before any step is recorded still renders a Retry CTA, and Retry can succeed', async () => {
    const characterPort = instantCommitPort(CHAR_A);
    characterPort.appendTx.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    const { campaignPort } = configure({ rows: [mkRow(CHAR_A, 'Aria')], characterPort });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__pick')!.click();
    await whenStable(fixture);

    expect(compiled.querySelector('.link-character__step')).toBeNull(); // no step ever recorded
    expect(compiled.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      campaignsEn.link.errors.characterNotLeader,
    );
    const retryButton = compiled.querySelector<HTMLButtonElement>('.link-character__retry');
    expect(retryButton).toBeTruthy();

    retryButton!.click();
    await whenStable(fixture);

    expect(characterPort.appendTx).toHaveBeenCalledTimes(2); // 1 failed attempt + 1 successful retry
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
  });

  it('the full JOIN happy path: loads the character, runs both steps, then navigates to the lobby', async () => {
    const { characterPort, campaignPort, characterLoad } = configure({
      rows: [mkRow(CHAR_A, 'Aria')],
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__pick')!.click();
    await whenStable(fixture);

    expect(characterLoad).toHaveBeenCalledWith(CHAR_A);
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1);
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    const charDrafts = characterPort.appendTx.mock.calls[0][0] as DraftEvent[];
    const charDraft = charDrafts[0];
    expect(charDraft).toEqual({
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
  });

  it('the (a)-committed/(b)-rejected recovery path: shows "link incomplete — retry", then Retry alone succeeds', async () => {
    const campaignPort = rejectOnceThenCommitPort(`camp:${CAMPAIGN_ID}`);
    const { characterPort } = configure({ rows: [mkRow(CHAR_A, 'Aria')], campaignPort });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__pick')!.click();
    // Real settle (the reject fires ~10ms after the append): poll the DOM for the outcome.
    const deadline = Date.now() + 2000;
    while (
      !compiled.textContent?.includes(campaignsEn.link.progress.incomplete) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await fixture.whenStable();
    }

    expect(compiled.textContent).toContain(campaignsEn.link.progress.incomplete);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1); // step (a) never resent

    const retryButton = compiled.querySelector<HTMLButtonElement>('.link-character__retry')!;
    expect(retryButton).toBeTruthy();
    retryButton.click();
    await whenStable(fixture);

    expect(campaignPort.appendTx).toHaveBeenCalledTimes(2);
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1); // still never resent
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
  });

  it('"create a new character" navigates to the wizard with a returnUrl back to this screen', async () => {
    configure({});
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__create-new')!.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/characters/new'], {
      queryParams: { returnUrl: `/g/${CAMPAIGN_ID}/link-character` },
    });
  });

  it('"skip for now" navigates straight to the lobby without linking anything', async () => {
    const { characterPort, campaignPort } = configure({});
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__skip')!.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'lobby']);
    expect(characterPort.appendTx).not.toHaveBeenCalled();
    expect(campaignPort.appendTx).not.toHaveBeenCalled();
  });

  it('shows the campaign not-leader message (scope-relative, no double prefix) when step (b) throws CampaignStoreNotLeaderError', async () => {
    const campaignPort = instantCommitPort(`camp:${CAMPAIGN_ID}`);
    campaignPort.appendTx.mockRejectedValueOnce(new CampaignStoreNotLeaderError());
    configure({ rows: [mkRow(CHAR_A, 'Aria')], campaignPort });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__pick')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-leader']);
  });

  it('shows a local characters-scope message (not the foreign characters.not-leader key) when step (a) throws CharacterStoreNotLeaderError', async () => {
    const characterPort = instantCommitPort(CHAR_A);
    characterPort.appendTx.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    configure({ rows: [mkRow(CHAR_A, 'Aria')], characterPort });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.link-character__pick')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn.link.errors.characterNotLeader);
  });

  // [plan-10 Task 12] Ruling 6's claim flow, M's own half: once the DM's handover fully commits,
  // the roster ALREADY lists M as the owner of a character M never created locally — this is the
  // ONLY way such a character is ever surfaced back to M (see `ClaimedPregen`'s own class doc for
  // the full server-rule tracing of why no further protocol action is offered here).
  it('shows a pregen HANDED TO ME (roster ownerId === my userId, not among my own local characters) as "claimed", with an honest note and a Go-to-party action', async () => {
    const PREGEN_ID = 'd0000000-0000-4000-8000-0000000000f9';
    configure({
      rows: [mkRow(CHAR_A, 'Aria')],
      roster: {
        [PREGEN_ID]: { ownerId: OWNER_ID, name: 'Pregen Paul', left: false },
      },
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Pregen Paul');
    expect(compiled.textContent).toContain(campaignsEn.link.claimed.title);
    const action = compiled.querySelector<HTMLButtonElement>('.link-character__claimed-action')!;
    expect(action).toBeTruthy();

    action.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/g', CAMPAIGN_ID, 'party']);
  });

  it('does NOT show a roster entry as claimed when it belongs to someone else, is left, or is already one of my own local characters', async () => {
    const OTHER_OWNED = 'd0000000-0000-4000-8000-0000000000fa';
    const LEFT_ONE = 'd0000000-0000-4000-8000-0000000000fb';
    configure({
      rows: [mkRow(CHAR_A, 'Aria')],
      roster: {
        [OTHER_OWNED]: { ownerId: 'usr_someone_else', name: 'Not Mine', left: false },
        [LEFT_ONE]: { ownerId: OWNER_ID, name: 'Already Left', left: true },
        [CHAR_A.slice('char:'.length)]: { ownerId: OWNER_ID, name: 'Aria', left: false },
      },
    });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.link-character__claimed')).toBeNull();
    expect(compiled.textContent).not.toContain('Not Mine');
    expect(compiled.textContent).not.toContain('Already Left');
  });

  it('shows the empty state when the account has no characters at all', async () => {
    configure({ rows: [] });
    const fixture = TestBed.createComponent(LinkCharacterComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.link-character__empty')?.textContent?.trim()).toBe(
      campaignsEn.link.empty,
    );
  });
});
