import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { Event } from '@hk/protocol';
import type { DraftEvent } from '@shared/stores/character.store';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import {
  CampaignStore,
  CampaignStoreNotLeaderError,
  type AckOrReject,
} from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import {
  UnlinkCharacterDialogComponent,
  type UnlinkCharacterDialogData,
} from './unlink-character-dialog.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_ID = '00000000-0000-4000-8000-0000000000c1';
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

function mkEvent(type: string, payload: unknown, seq?: number): Event {
  return {
    id: freshId(),
    stream: `camp:${CAMPAIGN_ID}`,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_dm1', deviceId: 'dev_dm', role: 'dm' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

function instantCommitAppendTx(
  events: WritableSignal<Event[]>,
): ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>> {
  let seq = 1;
  return vi.fn<(drafts: DraftEvent[]) => Promise<void>>((drafts) => {
    const draft = drafts[0];
    events.set([...events(), mkEvent(draft.type, draft.payload, seq++)]);
    return Promise.resolve();
  });
}

function configure(options: {
  gatewayAppend?: ReturnType<
    typeof vi.fn<(characterId: string, drafts: DraftEvent[]) => Promise<AckOrReject>>
  >;
  appendTx?: ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>>;
  data?: UnlinkCharacterDialogData;
}): {
  close: ReturnType<typeof vi.fn>;
  setDismissible: ReturnType<typeof vi.fn>;
  gatewayAppend: ReturnType<typeof vi.fn>;
  appendTx: ReturnType<typeof vi.fn>;
  events: WritableSignal<Event[]>;
} {
  const close = vi.fn();
  const setDismissible = vi.fn();
  const events = signal<Event[]>([]);
  const appendTx = options.appendTx ?? instantCommitAppendTx(events);
  const gatewayAppend =
    options.gatewayAppend ??
    vi
      .fn<(characterId: string, drafts: DraftEvent[]) => Promise<AckOrReject>>()
      .mockResolvedValue({ acked: [{ id: 'x', seq: 1 }], rejected: [] });
  const data: UnlinkCharacterDialogData = options.data ?? {
    campaignId: CAMPAIGN_ID,
    characterId: CHARACTER_ID,
    ownerId: OWNER_ID,
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
        provide: CampaignStore,
        useValue: { events: events.asReadonly(), appendTx, gatewayAppend },
      },
    ],
  });

  return { close, setDismissible, gatewayAppend, appendTx, events };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

describe('UnlinkCharacterDialogComponent', () => {
  it('shows a confirm step first, with the character name interpolated', async () => {
    configure({});
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Aria');
    expect(compiled.querySelector('.unlink-character-dialog__confirm')).toBeTruthy();
  });

  it('Cancel closes with false and touches neither gatewayAppend nor appendTx', async () => {
    const { close, gatewayAppend, appendTx } = configure({});
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__cancel')!.click();

    expect(close).toHaveBeenCalledWith(false);
    expect(gatewayAppend).not.toHaveBeenCalled();
    expect(appendTx).not.toHaveBeenCalled();
  });

  it('Confirm runs BOTH steps (gatewayAppend on char:<id>, then campaign appendTx with the roster owner) and closes true', async () => {
    const { close, gatewayAppend, appendTx } = configure({});
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'character.campaign_left', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
    expect(appendTx).toHaveBeenCalledWith([
      {
        type: 'campaign.character_left',
        v: 1,
        payload: { characterId: CHARACTER_ID, ownerId: OWNER_ID, name: 'Aria' },
      },
    ]);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('blocks dismissal for the whole in-flight window, and re-allows it once settled', async () => {
    const { setDismissible } = configure({});
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(setDismissible).not.toHaveBeenCalled();
    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(setDismissible.mock.calls.map((c: unknown[]) => c[0])).toEqual([false, true]);
  });

  it('a rejected step (a): shows "incomplete — retry", and Retry re-runs the whole sequence', async () => {
    const gatewayAppend = vi
      .fn<(characterId: string, drafts: DraftEvent[]) => Promise<AckOrReject>>()
      .mockResolvedValueOnce({ acked: [], rejected: [{ id: 'x', code: 'forbidden' }] })
      .mockResolvedValueOnce({ acked: [{ id: 'y', seq: 1 }], rejected: [] });
    const { close, appendTx } = configure({ gatewayAppend });
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(compiled.textContent).toContain(campaignsEn.unlink.incomplete);
    expect(close).not.toHaveBeenCalled();
    expect(appendTx).not.toHaveBeenCalled();

    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__retry')!.click();
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledTimes(2);
    expect(appendTx).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('shows the scope-relative not-leader message when step (b) throws CampaignStoreNotLeaderError', async () => {
    const appendTx = vi
      .fn<(drafts: DraftEvent[]) => Promise<void>>()
      .mockRejectedValue(new CampaignStoreNotLeaderError());
    configure({ appendTx });
    const fixture = TestBed.createComponent(UnlinkCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.unlink-character-dialog__confirm')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-leader']);
  });
});
