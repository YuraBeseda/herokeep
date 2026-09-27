import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { Event } from '@hk/protocol';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import type { DraftEvent } from '@shared/stores/character.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import {
  HandoverCharacterDialogComponent,
  type HandoverCharacterDialogData,
} from './handover-character-dialog.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_ID = '00000000-0000-4000-8000-0000000000c1';
const DM_ID = 'usr_dm1';
const MEMBER_A = 'usr_alice';
const MEMBER_B = 'usr_bob';

interface RosterEntryFixture {
  ownerId: string;
  name: string;
  left: boolean;
}
interface MemberFixture {
  displayName: string;
  role: 'dm' | 'player';
  removed: boolean;
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

/** Commits every appended draft INSTANTLY (a fresh `seq` from the first write) — `stream` is
 * derived from the draft's own type (char-side leave/rejoin/transfer types all target
 * `char:<CHARACTER_ID>`, campaign-side left/joined target `camp:<CAMPAIGN_ID>` — this fake never
 * needs to know which port is calling it, it just stamps the matching stream). */
function instantCommitAppendTx(
  events: WritableSignal<Event[]>,
  stream: string,
): ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>> {
  let seq = events().filter((e) => e.seq !== undefined).length + 1;
  return vi.fn<(drafts: DraftEvent[]) => Promise<void>>((drafts) => {
    const now = [...events()];
    for (const draft of drafts) {
      now.push({
        id: freshId(),
        stream,
        ts: '2026-09-26T00:00:00.000Z',
        actor: { userId: DM_ID, deviceId: 'dev_dm', role: 'owner' },
        type: draft.type,
        v: draft.v,
        payload: draft.payload,
        seq: seq++,
      });
    }
    events.set(now);
    return Promise.resolve();
  });
}

function configure(options: {
  characterAppendTx?: ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>>;
  campaignAppendTx?: ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>>;
  characterLoad?: ReturnType<typeof vi.fn>;
  data?: HandoverCharacterDialogData;
  members?: Record<string, MemberFixture>;
  roster?: Record<string, RosterEntryFixture>;
}): {
  close: ReturnType<typeof vi.fn>;
  setDismissible: ReturnType<typeof vi.fn>;
  characterAppendTx: ReturnType<typeof vi.fn>;
  campaignAppendTx: ReturnType<typeof vi.fn>;
  characterLoad: ReturnType<typeof vi.fn>;
  characterEvents: WritableSignal<Event[]>;
  roster: Map<string, RosterEntryFixture>;
} {
  const close = vi.fn();
  const setDismissible = vi.fn();
  const characterEvents = signal<Event[]>([]);
  const characterAppendTx =
    options.characterAppendTx ?? instantCommitAppendTx(characterEvents, `char:${CHARACTER_ID}`);
  const campaignEvents = signal<Event[]>([]);
  const campaignAppendTx =
    options.campaignAppendTx ?? instantCommitAppendTx(campaignEvents, `camp:${CAMPAIGN_ID}`);
  const characterLoad = options.characterLoad ?? vi.fn().mockResolvedValue(undefined);
  const data: HandoverCharacterDialogData = options.data ?? {
    campaignId: CAMPAIGN_ID,
    characterId: CHARACTER_ID,
    characterName: 'Pregen Paul',
    fromOwnerId: DM_ID,
  };
  const members = new Map(
    Object.entries(
      options.members ?? {
        [DM_ID]: { displayName: 'The DM', role: 'dm', removed: false },
        [MEMBER_A]: { displayName: 'Alice', role: 'player', removed: false },
        [MEMBER_B]: { displayName: 'Bob', role: 'player', removed: false },
      },
    ),
  );
  const roster = new Map(
    Object.entries(
      options.roster ?? { [CHARACTER_ID]: { ownerId: DM_ID, name: 'Pregen Paul', left: false } },
    ),
  );

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
        useValue: {
          state: signal({ members, roster }),
          events: campaignEvents.asReadonly(),
          appendTx: campaignAppendTx,
        },
      },
      {
        provide: CharacterStore,
        useValue: {
          load: characterLoad,
          events: characterEvents.asReadonly(),
          appendTx: characterAppendTx,
        },
      },
    ],
  });

  return {
    close,
    setDismissible,
    characterAppendTx,
    campaignAppendTx,
    characterLoad,
    characterEvents,
    roster,
  };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

describe('HandoverCharacterDialogComponent', () => {
  it('shows a member picker first, with the character name interpolated into the title', async () => {
    configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Pregen Paul');
    expect(compiled.textContent).toContain('Alice');
    expect(compiled.textContent).toContain('Bob');
    expect(compiled.textContent).not.toContain('The DM'); // the DM is never a handover target
    expect(compiled.querySelector('.handover-character-dialog__confirm')).toBeTruthy();
  });

  it('a11y: the title element carries data-dialog-title, with the character name interpolated', async () => {
    configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    const title = compiled.querySelector('[data-dialog-title]');
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain('Pregen Paul');
  });

  it('excludes a REMOVED member from the picker', async () => {
    configure({
      members: {
        [DM_ID]: { displayName: 'The DM', role: 'dm', removed: false },
        [MEMBER_A]: { displayName: 'Alice', role: 'player', removed: false },
        [MEMBER_B]: { displayName: 'Bob', role: 'player', removed: true },
      },
    });
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Alice');
    expect(compiled.textContent).not.toContain('Bob');
  });

  it('Confirm is disabled until a member is selected', async () => {
    configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    const confirm = compiled.querySelector<HTMLButtonElement>(
      '.handover-character-dialog__confirm',
    )!;
    expect(confirm.disabled).toBe(true);

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    expect(confirm.disabled).toBe(false);
  });

  it('Cancel closes with false and touches neither store', async () => {
    const { close, characterAppendTx, campaignAppendTx } = configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__cancel')!.click();

    expect(close).toHaveBeenCalledWith(false);
    expect(characterAppendTx).not.toHaveBeenCalled();
    expect(campaignAppendTx).not.toHaveBeenCalled();
  });

  it('Confirm loads the character then runs the FULL 5-step sequence in order and closes true', async () => {
    const { close, characterLoad, characterAppendTx, campaignAppendTx } = configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(characterLoad).toHaveBeenCalledWith(CHARACTER_ID);
    expect(characterAppendTx).toHaveBeenCalledTimes(3); // leave, rejoin, transfer
    expect(campaignAppendTx).toHaveBeenCalledTimes(2); // roster clear, roster rejoin
    const transferDraft = (characterAppendTx.mock.calls[2][0] as DraftEvent[])[0];
    expect(transferDraft).toEqual({
      type: 'character.owner_transferred',
      v: 1,
      payload: { toUserId: MEMBER_A },
    });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('blocks dismissal for the whole in-flight window, and re-allows it once settled', async () => {
    const { setDismissible } = configure({});
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    expect(setDismissible).not.toHaveBeenCalled();
    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(setDismissible.mock.calls.map((c: unknown[]) => c[0])).toEqual([false, true]);
  });

  it('a rejected step shows "incomplete — retry", and Retry resumes (never re-sends an already-committed step)', async () => {
    const characterAppendTx = vi
      .fn<(drafts: DraftEvent[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('simulated reject'));
    const { close, characterEvents } = configure({ characterAppendTx });
    // The first (real) call above rejects with no event ever recorded — simulate the SECOND retry
    // attempt succeeding by swapping in an instant-commit fake after the first call.
    characterAppendTx.mockImplementation(
      instantCommitAppendTx(characterEvents, `char:${CHARACTER_ID}`),
    );
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(compiled.textContent).toContain(campaignsEn.handover.incomplete);
    expect(close).not.toHaveBeenCalled();

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__retry')!.click();
    await whenStable(fixture);

    expect(close).toHaveBeenCalledWith(true);
  });

  it('shows the scope-relative not-leader message when a campaign-side step throws CampaignStoreNotLeaderError', async () => {
    const campaignAppendTx = vi
      .fn<(drafts: DraftEvent[]) => Promise<void>>()
      .mockRejectedValue(new CampaignStoreNotLeaderError());
    configure({ campaignAppendTx });
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__confirm')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-leader']);
  });

  it('shows a local characters-scope message (not the foreign characters.not-leader key) when a char-side step throws CharacterStoreNotLeaderError', async () => {
    const characterAppendTx = vi
      .fn<(drafts: DraftEvent[]) => Promise<void>>()
      .mockRejectedValue(new CharacterStoreNotLeaderError());
    configure({ characterAppendTx });
    const fixture = TestBed.createComponent(HandoverCharacterDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__member')!.click();
    await whenStable(fixture);
    compiled.querySelector<HTMLButtonElement>('.handover-character-dialog__confirm')!.click();
    await whenStable(fixture);

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn.handover.errors.characterNotLeader);
  });
});
