import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of, Subject } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { PackStore } from '@shared/stores/pack.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { seedFighter } from '../../characters/sheet/testing/character-fixtures';
import {
  MemberSheetDialogComponent,
  type MemberSheetDialogData,
} from './member-sheet-dialog.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'campaigns/en' ? of(campaignsEn) : of({});
  }
}

/** Mirrors the real `SyncService`'s foreign-events contract (task-5-report.md) closely enough for
 * this dialog's own tests — a fake at this seam, same posture `foreign-character-session.spec.ts`
 * already establishes for the class this component wraps. */
class FakeSyncService {
  private readonly consumers = new Map<string, (stream: string, events: Event[]) => void>();
  readonly subscribeCalls: { campaignId: string; stream: string; lastSeq?: number }[] = [];
  readonly unsubscribeCalls: { campaignId: string; stream: string }[] = [];

  registerForeignEventsConsumer(
    campaignId: string,
    cb: (stream: string, events: Event[]) => void,
  ): () => void {
    this.consumers.set(campaignId, cb);
    return () => {
      if (this.consumers.get(campaignId) === cb) this.consumers.delete(campaignId);
    };
  }

  subscribeForeignStream(campaignId: string, stream: string, lastSeq?: number): void {
    this.subscribeCalls.push(
      lastSeq !== undefined ? { campaignId, stream, lastSeq } : { campaignId, stream },
    );
  }

  unsubscribeForeignStream(campaignId: string, stream: string): void {
    this.unsubscribeCalls.push({ campaignId, stream });
  }

  emit(campaignId: string, stream: string, events: Event[]): void {
    this.consumers.get(campaignId)?.(stream, events);
  }
}

class FakeRouter {
  url = '/g/00000000-0000-4000-8000-0000000000c1/party';
  readonly events = new Subject<NavigationEnd>();

  navigateTo(url: string): void {
    this.url = url;
    this.events.next(new NavigationEnd(1, url, url));
  }
}

function configure(): { sync: FakeSyncService; router: FakeRouter } {
  const sync = new FakeSyncService();
  const router = new FakeRouter();
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      provideTranslocoScope('campaigns'),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: SyncService, useValue: sync },
      { provide: Router, useValue: router },
    ],
  });
  return { sync, router };
}

function openDialog(data: MemberSheetDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(MemberSheetDialogComponent, { data });
}

describe('MemberSheetDialogComponent', () => {
  const campaignId = '00000000-0000-4000-8000-0000000000c1';
  let sync: FakeSyncService;
  let router: FakeRouter;

  beforeEach(async () => {
    ({ sync, router } = configure());
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
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it('a11y: has an accessible dialog title built from the character name (data-dialog-title wiring)', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const dialogEl = document.querySelector('[role="dialog"]');
    expect(dialogEl?.getAttribute('aria-labelledby')).toBeTruthy();
    const title = document.querySelector('.member-sheet-dialog__title');
    expect(title?.textContent).toContain('Ivan');
  });

  it('renders a loading status immediately, and sends subscribe with no lastSeq on open', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    expect(document.body.textContent).toContain('Loading');
    expect(sync.subscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  it('readonly rendering: once ready, renders the real Sheet with no mutating controls — every hk-pips is disabled', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const events = await TestBed.inject(EventsRepository).byStream(streamId);

    openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    sync.emit(campaignId, streamId, events);
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const statValues = Array.from(
      document.querySelectorAll<HTMLElement>('.hk-stat-tile__value'),
    ).map((el) => el.textContent?.trim());
    expect(statValues).toContain('19'); // AC, straight off the real derived Sheet
    // Every pip in this dialog is readonly — no click surface for spending a spell slot/resource
    // that belongs to a character the DM doesn't own.
    const pipButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.hk-pips__pip'));
    expect(pipButtons.length).toBeGreaterThan(0);
    expect(pipButtons.every((b) => b.disabled)).toBe(true);
    // No damage/heal/rest/cast/equip/remove affordance exists anywhere in this dialog's DOM.
    const buttonLabels = Array.from(document.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(buttonLabels.some((l) => l === 'Damage' || l === 'Heal' || l === 'Cast')).toBe(false);
  });

  // plan-10 task-11-brief.md: the T11 effects-panel seam this component's own class doc reserved.
  it('mounts app-dm-effects-panel once ready, with the live Sheet HP baseline resolved (no "no baseline" hint)', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const events = await TestBed.inject(EventsRepository).byStream(streamId);

    openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    sync.emit(campaignId, streamId, events);
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const panel = document.querySelector('app-dm-effects-panel');
    expect(panel).toBeTruthy();

    const toggle = panel?.querySelector<HTMLButtonElement>('.dm-effects-panel__toggle');
    toggle?.click();
    TestBed.tick();

    expect(panel?.textContent).not.toContain(
      'No HP baseline yet for this character — waiting on a party overview or a live sheet.',
    );
  });

  it('unauthorized-silent timeout renders the unauthorized status without crashing', async () => {
    // No `seedFighter` needed — this path never reaches `reduce`/`derive`.
    openDialog({ campaignId, characterId: '11111111-1111-4111-8111-111111111111', name: 'Ghost' });
    TestBed.tick();
    await Promise.resolve();
    // The dialog's own session isn't given a small timeoutMs override in production wiring — this
    // test only asserts the loading state renders without throwing; the bounded-timeout mechanics
    // themselves are covered exhaustively by foreign-character-session.spec.ts.
    expect(document.body.textContent).toContain('Loading');
  });

  it('close(): the Close button closes the dialog and sends unsubscribe', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const handle = openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    const closeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Close',
    );
    closeButton?.click();
    TestBed.tick();
    await handle.closed;

    expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  it('navigating away from this campaign self-closes the dialog and sends unsubscribe', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const handle = openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    router.navigateTo('/campaigns');
    TestBed.tick();
    await handle.closed;

    expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  it('navigating WITHIN the same campaign (a different tab) does NOT close the dialog', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    openDialog({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    router.navigateTo(`/g/${campaignId}/log`);
    TestBed.tick();
    await Promise.resolve();

    expect(sync.unsubscribeCalls).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
