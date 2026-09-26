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
 * this never wait on a real timer. */
function instantCommitPort(streamId: string): {
  events: WritableSignal<Event[]>;
  appendTx: ReturnType<typeof vi.fn>;
} {
  const events = signal<Event[]>([]);
  let seq = 1;
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
    const { characterPort, campaignPort, characterLoad } = configure({
      rows: [mkRow(CHAR_D, 'Dara')],
      eventsByCharacter: {
        [CHAR_D]: [mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID }, CHAR_D, 1)],
      },
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

    expect(characterLoad).not.toHaveBeenCalled();
    expect(characterPort.appendTx).not.toHaveBeenCalled();
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
