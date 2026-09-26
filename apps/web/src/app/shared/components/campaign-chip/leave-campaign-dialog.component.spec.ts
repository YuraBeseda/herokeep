import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { Event } from '@hk/protocol';
import type { DraftEvent } from '@shared/stores/character.store';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import type { AuthUser } from '@shared/services/auth/auth.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import {
  LeaveCampaignDialogComponent,
  type LeaveCampaignDialogData,
} from './leave-campaign-dialog.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_STREAM = 'char:00000000-0000-4000-8000-0000000000c1';
const OWNER_ID = 'usr_owner1';

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
      setTimeout(() => events.set(events().filter((e) => e.id !== event.id)), 10);
    } else {
      events.set(events().map((e) => (e.id === event.id ? { ...e, seq: seq++ } : e)));
    }
    return Promise.resolve();
  });
  return { events, appendTx };
}

function configure(options: {
  characterPort?: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignPort?: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignOpen?: ReturnType<typeof vi.fn>;
  user?: AuthUser | null;
  data?: LeaveCampaignDialogData;
}): {
  close: ReturnType<typeof vi.fn>;
  setDismissible: ReturnType<typeof vi.fn>;
  characterPort: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignPort: { events: WritableSignal<Event[]>; appendTx: ReturnType<typeof vi.fn> };
  campaignOpen: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const setDismissible = vi.fn();
  const characterPort = options.characterPort ?? instantCommitPort(CHARACTER_STREAM);
  const campaignPort = options.campaignPort ?? instantCommitPort(`camp:${CAMPAIGN_ID}`);
  const campaignOpen = options.campaignOpen ?? vi.fn().mockResolvedValue(undefined);
  const user = options.user === undefined ? { userId: OWNER_ID, username: 'alice' } : options.user;
  const data: LeaveCampaignDialogData = options.data ?? {
    campaignId: CAMPAIGN_ID,
    characterId: CHARACTER_STREAM,
    characterName: 'Aria',
  };

  TestBed.configureTestingModule({
    providers: [
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
      { provide: DialogRef, useValue: { close, setDismissible } },
      { provide: DIALOG_DATA, useValue: data },
      {
        provide: CharacterStore,
        useValue: { events: characterPort.events.asReadonly(), appendTx: characterPort.appendTx },
      },
      {
        provide: CampaignStore,
        useValue: {
          open: campaignOpen,
          events: campaignPort.events.asReadonly(),
          appendTx: campaignPort.appendTx,
        },
      },
      { provide: AuthService, useValue: { user: signal(user) } },
    ],
  });

  return { close, setDismissible, characterPort, campaignPort, campaignOpen };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

describe('LeaveCampaignDialogComponent', () => {
  it('shows a confirm step first, with the character name interpolated', async () => {
    configure({});
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Aria');
    expect(compiled.querySelector('.leave-campaign-dialog__confirm')).toBeTruthy();
  });

  it('Cancel closes with false and touches neither store', async () => {
    const { close, characterPort, campaignPort } = configure({});
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__cancel')!.click();

    expect(close).toHaveBeenCalledWith(false);
    expect(characterPort.appendTx).not.toHaveBeenCalled();
    expect(campaignPort.appendTx).not.toHaveBeenCalled();
  });

  it('Confirm opens the right campaign stream, runs the LEAVE sequence (character.campaign_left then campaign.character_left), and closes with true', async () => {
    const { close, characterPort, campaignPort, campaignOpen } = configure({});
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(campaignOpen).toHaveBeenCalledWith(`camp:${CAMPAIGN_ID}`);
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1);
    const charDrafts = characterPort.appendTx.mock.calls[0][0] as DraftEvent[];
    const charDraft = charDrafts[0];
    expect(charDraft).toEqual({
      type: 'character.campaign_left',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    });
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    const campDrafts = campaignPort.appendTx.mock.calls[0][0] as DraftEvent[];
    const campDraft = campDrafts[0];
    expect(campDraft).toEqual({
      type: 'campaign.character_left',
      v: 1,
      payload: {
        characterId: CHARACTER_STREAM.slice('char:'.length),
        ownerId: OWNER_ID,
        name: 'Aria',
      },
    });
    expect(close).toHaveBeenCalledWith(true);
  });

  // Fix round 1, finding 1(i): a dismissed-mid-leave dialog is exactly what strands a character
  // half-left with no surviving UI — guard against ESC/backdrop for the whole in-flight window.
  it('blocks dismissal (setDismissible(false)) for the whole in-flight window, and re-allows it once settled', async () => {
    const { setDismissible } = configure({});
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(setDismissible).not.toHaveBeenCalled();
    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(setDismissible.mock.calls.map((c: unknown[]) => c[0])).toEqual([false, true]);
  });

  it('the (a)-committed/(b)-rejected recovery path: shows "link incomplete — retry", then Retry alone succeeds', async () => {
    const campaignPort = rejectOnceThenCommitPort(`camp:${CAMPAIGN_ID}`);
    const { close, characterPort } = configure({ campaignPort });
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();

    const deadline = Date.now() + 2000;
    while (
      !compiled.textContent?.includes(campaignsEn.link.progress.incomplete) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await fixture.whenStable();
    }

    expect(compiled.textContent).toContain(campaignsEn.link.progress.incomplete);
    expect(close).not.toHaveBeenCalled();
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1); // step (a) never resent

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__retry')!.click();
    await whenStable(fixture);

    expect(campaignPort.appendTx).toHaveBeenCalledTimes(2);
    expect(characterPort.appendTx).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('shows the scope-relative not-authenticated message (no double prefix) when no user is signed in', async () => {
    configure({ user: null });
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-authenticated']);
  });

  it('shows the local characterNotLeader message when step (a) throws CharacterStoreNotLeaderError', async () => {
    const characterPort = instantCommitPort(CHARACTER_STREAM);
    characterPort.appendTx.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    configure({ characterPort });
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn.link.errors.characterNotLeader);
  });

  // Fix round 1, finding 3: this exact scenario (a thrown exception before any step is ever
  // recorded) must still leave a Retry CTA — not a dead-end error banner with nothing to click.
  it('finding 3: a thrown exception before any step is recorded still renders Retry, and Retry can succeed', async () => {
    const characterPort = instantCommitPort(CHARACTER_STREAM);
    characterPort.appendTx.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    const { close, campaignPort } = configure({ characterPort });
    const fixture = TestBed.createComponent(LeaveCampaignDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(compiled.querySelector('.leave-campaign-dialog__step')).toBeNull(); // no step recorded
    const retryButton = compiled.querySelector<HTMLButtonElement>('.leave-campaign-dialog__retry');
    expect(retryButton).toBeTruthy();

    retryButton!.click();
    await whenStable(fixture);

    expect(characterPort.appendTx).toHaveBeenCalledTimes(2); // 1 failed + 1 successful retry
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
  });
});
