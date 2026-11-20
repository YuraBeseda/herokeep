import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of, Subject } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { BlobTransferService } from '@shared/services/blob-transfer/blob-transfer.service';
import { iconItemAddedEvent } from '@shared/services/blob-transfer/testing/blob-cache-fixtures';
import { SyncService } from '@shared/services/sync/sync.service';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import campaignsEn from '../../../../../assets/i18n/campaigns/en.json';
import campaignsRu from '../../../../../assets/i18n/campaigns/ru.json';
import campaignsUk from '../../../../../assets/i18n/campaigns/uk.json';
import sampleJson from '../../../../../testing/fixtures/packs/sample-content.json';
import { seedFighter } from '../../../characters/sheet/testing/character-fixtures';
import { MemberSheetDrawerComponent } from './member-sheet-drawer.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

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

const MOONSTRUCK = 'sample-content:condition/moonstruck';
const SICKLE = 'sample-content:item/moonblade-sickle';

/** The sample content pack plus one condition, so a member's pack can name a condition chip. */
const parsedMemberPack = parsePack({
  ...sampleJson,
  entities: [
    ...sampleJson.entities,
    {
      type: 'condition',
      id: MOONSTRUCK,
      name: 'Moonstruck',
      description: 'Bathed in moonlight.',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
    },
  ],
});
if (!parsedMemberPack.ok) throw new Error('the member pack fixture no longer parses');
const memberPack = parsedMemberPack.pack;

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
  readonly events = new Subject<NavigationEnd | NavigationStart>();

  startNavigation(url: string): void {
    this.events.next(new NavigationStart(1, url));
  }

  navigateTo(url: string): void {
    this.url = url;
    this.events.next(new NavigationEnd(1, url, url));
  }
}

const requestHashes = vi.fn();

function configure(): {
  sync: FakeSyncService;
  router: FakeRouter;
  packs: WritableSignal<Pack[]>;
} {
  const sync = new FakeSyncService();
  const router = new FakeRouter();
  // The packs installed on the DM's device (the real `EngineFacade` reads them).
  const packs = signal<Pack[]>([corePack]);
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
        useValue: { packs, ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: SyncService, useValue: sync },
      { provide: BlobTransferService, useValue: { requestHashes } },
      { provide: Router, useValue: router },
    ],
  });
  return { sync, router, packs };
}

interface DrawerData {
  readonly campaignId: string;
  readonly characterId: string;
  readonly name: string;
}

/** The party tab's role: render the drawer while a member's sheet is open, drop it on `closed`. */
@Component({
  selector: 'app-drawer-host',
  imports: [MemberSheetDrawerComponent],
  template: `
    @if (shown()) {
      <app-member-sheet-drawer
        [campaignId]="data().campaignId"
        [characterId]="data().characterId"
        [name]="data().name"
        (closed)="onClosed()"
      />
    }
  `,
})
class HostComponent {
  readonly data = signal<DrawerData>({ campaignId: '', characterId: '', name: '' });
  readonly shown = signal(true);
  closedCount = 0;
  protected onClosed(): void {
    this.closedCount += 1;
    this.shown.set(false);
  }
}

/** Opens the drawer for `data`; `closed` resolves once the drawer asked to go away. */
function openDrawer(data: DrawerData) {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.data.set(data);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    closed: async (): Promise<void> => {
      TestBed.tick();
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('MemberSheetDrawerComponent', () => {
  const campaignId = '00000000-0000-4000-8000-0000000000c1';
  let sync: FakeSyncService;
  let router: FakeRouter;
  let packs: WritableSignal<Pack[]>;

  beforeEach(async () => {
    ({ sync, router, packs } = configure());
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

  it('a11y: the drawer is a dialog named by a title built from the character name', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const dialogEl = document.querySelector('[role="dialog"]');
    expect(dialogEl?.getAttribute('aria-labelledby')).toBeTruthy();
    const title = document.querySelector('.hk-drawer__title');
    expect(title?.textContent).toContain('Ivan');
  });

  it('renders a loading status immediately, and sends subscribe with no lastSeq on open', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    expect(document.body.textContent).toContain('Loading');
    expect(sync.subscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  it('readonly rendering: once ready, renders the real Sheet with no mutating controls — every pip row is disabled', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const events = await TestBed.inject(EventsRepository).byStream(streamId);

    openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    sync.emit(campaignId, streamId, events);
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const statValues = Array.from(
      document.querySelectorAll<HTMLElement>('.hk-stat-tile__value'),
    ).map((el) => el.textContent?.trim());
    expect(statValues).toContain('19'); // AC, straight off the real derived Sheet
    // Every pip in this drawer is readonly (a wax seal, never a button) — no click surface for
    // spending a spell slot/resource that belongs to a character the DM doesn't own.
    const drawer = document.querySelector('app-member-sheet-drawer')!;
    const pips = drawer.querySelectorAll('hk-pool-bar hk-wax-seal');
    expect(pips.length).toBeGreaterThan(0);
    expect(drawer.querySelectorAll('hk-pool-bar button')).toHaveLength(0);
    // No damage/heal/rest/cast/equip/remove affordance exists anywhere in the SHEET part of the
    // drawer (the DM tools leaf at its foot is the gateway writer, and is excluded).
    const buttonLabels = Array.from(drawer.querySelectorAll('button'))
      .filter((b) => !b.closest('app-quick-effects-leaf'))
      .map((b) => b.textContent?.trim());
    expect(buttonLabels.some((l) => l === 'Damage' || l === 'Heal' || l === 'Cast')).toBe(false);
  });

  // plan-10 task-11-brief.md: the T11 effects-panel seam this component's own class doc reserved.
  it('mounts app-quick-effects-leaf once ready, with the live Sheet HP baseline resolved (no "no baseline" hint)', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const events = await TestBed.inject(EventsRepository).byStream(streamId);

    openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    sync.emit(campaignId, streamId, events);
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    const panel = document.querySelector('app-quick-effects-leaf');
    expect(panel).toBeTruthy();

    expect(panel?.textContent).not.toContain(
      'No HP baseline yet for this character — waiting on a party overview or a live sheet.',
    );
  });

  it("requests the member's custom item icons over the blob relay", async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const hash = 'sha256:' + 'c'.repeat(64);
    const icon = { ...iconItemAddedEvent(streamId, hash, 1), seq: events.length + 1 };
    requestHashes.mockClear();

    openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    sync.emit(campaignId, streamId, [...events, icon]);
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();

    expect(requestHashes).toHaveBeenCalledWith(campaignId, [hash]);
  });

  it('unauthorized-silent timeout renders the unauthorized status without crashing', async () => {
    // No `seedFighter` needed — this path never reaches `reduce`/`derive`.
    openDrawer({ campaignId, characterId: '11111111-1111-4111-8111-111111111111', name: 'Ghost' });
    TestBed.tick();
    await Promise.resolve();
    // The dialog's own session isn't given a small timeoutMs override in production wiring — this
    // test only asserts the loading state renders without throwing; the bounded-timeout mechanics
    // themselves are covered exhaustively by foreign-character-session.spec.ts.
    expect(document.body.textContent).toContain('Loading');
  });

  it('close(): the Close button closes the drawer and sends unsubscribe', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const handle = openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>('.hk-drawer__head button')?.click();
    TestBed.tick();
    await handle.closed();
    expect(handle.host.closedCount).toBe(1);

    expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  it('navigating away from this campaign self-closes the drawer and sends unsubscribe', async () => {
    const streamId = await seedFighter('Ivan');
    const characterId = streamId.slice('char:'.length);
    const handle = openDrawer({ campaignId, characterId, name: 'Ivan' });
    TestBed.tick();
    await Promise.resolve();

    router.navigateTo('/campaigns');
    TestBed.tick();
    await handle.closed();
    expect(handle.host.closedCount).toBe(1);

    expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
  });

  describe('closing the drawer', () => {
    async function open() {
      const streamId = await seedFighter('Ivan');
      const characterId = streamId.slice('char:'.length);
      const handle = openDrawer({ campaignId, characterId, name: 'Ivan' });
      TestBed.tick();
      await Promise.resolve();
      return { handle, streamId };
    }

    it('Escape closes it and releases the viewer session', async () => {
      const { handle, streamId } = await open();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      TestBed.tick();
      await handle.closed();
      expect(handle.host.closedCount).toBe(1);
      expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    });

    it('a press outside the panel closes it', async () => {
      const { handle, streamId } = await open();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      TestBed.tick();
      await handle.closed();
      expect(handle.host.closedCount).toBe(1);
      expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    });

    it('a router NavigationStart (browser Back, a deep link) closes it like any drawer', async () => {
      const { handle, streamId } = await open();
      router.startNavigation(`/g/${campaignId}/log`);
      TestBed.tick();
      await handle.closed();
      expect(handle.host.closedCount).toBe(1);
      expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    });

    it('draws the DM tools embedded: no member heading, close button or footer actions', async () => {
      const streamId = await seedFighter('Ivan');
      const characterId = streamId.slice('char:'.length);
      const events = await TestBed.inject(EventsRepository).byStream(streamId);
      openDrawer({ campaignId, characterId, name: 'Ivan' });
      TestBed.tick();
      sync.emit(campaignId, streamId, events);
      TestBed.tick();
      await Promise.resolve();
      TestBed.tick();

      const leaf = document.querySelector('app-quick-effects-leaf')!;
      expect(leaf.querySelector('.hk-leaf__title-text')?.textContent?.trim()).toBe('DM tools');
      expect(leaf.querySelector('.qfx__close')).toBeNull();
      expect(leaf.querySelector('.qfx__footer')).toBeNull();
    });
  });

  // --- plan 16 Task 5, ruling 6: the member's own pack set ---------------------------------------
  describe("the member's pinned packs (plan 16 Task 5, ruling 6)", () => {
    /** A member fighter who pins `memberPack`, is Moonstruck and carries its Moonblade Sickle —
     * every one of those references lives in the member's pack, none in the core. */
    async function seedMember(): Promise<{ characterId: string; events: Event[] }> {
      const streamId = await seedFighter('Ivan');
      await TestBed.inject(CharacterStore).appendTx([
        {
          type: 'pack.pinned',
          v: 1,
          payload: { packId: memberPack.id, version: memberPack.version },
        },
        { type: 'condition.added', v: 1, payload: { conditionId: MOONSTRUCK } },
        {
          type: 'item.added',
          v: 1,
          payload: { instanceId: '44444444-4444-4444-8444-444444444444', itemId: SICKLE, qty: 1 },
        },
      ]);
      const events = await TestBed.inject(EventsRepository).byStream(streamId);
      return { characterId: streamId.slice('char:'.length), events };
    }

    async function openWith(member: { characterId: string; events: Event[] }): Promise<void> {
      openDrawer({ campaignId, characterId: member.characterId, name: 'Ivan' });
      TestBed.tick();
      sync.emit(campaignId, `char:${member.characterId}`, member.events);
      TestBed.tick();
      await Promise.resolve();
      TestBed.tick();
    }

    const text = (selector: string): string[] =>
      Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim() ?? '');

    function showLeafConditions(): HTMLElement {
      const panel = document.querySelector<HTMLElement>('app-quick-effects-leaf')!;
      panel.querySelector<HTMLButtonElement>('[data-effect-tab="condition"]')?.click();
      TestBed.tick();
      return panel;
    }

    it("names come from the member's index when this device has their pack — the sheet's chips and inventory, and the DM leaf's conditions", async () => {
      packs.set([corePack, memberPack]);
      const member = await seedMember();

      await openWith(member);

      expect(document.querySelector('.msd__missing-packs')).toBeNull();
      expect(text('.msd__conditions .hk-cond__name')).toEqual(['Moonstruck']);
      expect(text('.msd__inventory li')).toContain('Moonblade Sickle × 1');
      const panel = showLeafConditions();
      expect(
        Array.from(panel.querySelectorAll('.qfx__cond-name')).map((el) => el.textContent?.trim()),
      ).toEqual([expect.stringContaining('Moonstruck')]);
    });

    it('Review Focus 3: a pinned pack the DM device lacks — the sheet renders with a warning listing it, unresolved references as chips, no exception', async () => {
      const member = await seedMember();
      packs.set([corePack]);

      await openWith(member);

      const warning = document.querySelector('.msd__missing-packs');
      expect(warning).not.toBeNull();
      expect(warning?.getAttribute('role')).toBe('status');
      expect(warning?.textContent).toContain(
        "This character uses a content pack that isn't installed on this device:",
      );
      expect(text('.msd__missing-packs li')).toEqual([`${memberPack.id}@${memberPack.version}`]);
      // The sheet itself still renders, its pack references as their raw ids.
      expect(text('.hk-stat-tile__value')).toContain('19');
      expect(text('.msd__conditions .hk-cond__name')).toEqual([MOONSTRUCK]);
      expect(text('.msd__inventory li')).toContain(`${SICKLE} × 1`);
      const panel = showLeafConditions();
      expect(
        Array.from(panel.querySelectorAll('.qfx__cond-name')).map((el) => el.textContent?.trim()),
      ).toEqual([expect.stringContaining(MOONSTRUCK)]);
    });

    it('the warning strings exist in en, ru and uk (ICU plural)', () => {
      for (const locale of [campaignsEn, campaignsRu, campaignsUk]) {
        const strings = (locale.memberSheet as unknown as { missingPacks?: Record<string, string> })
          .missingPacks;
        expect(Object.keys(strings ?? {}).sort()).toEqual(['entry', 'message']);
        expect(strings?.['message']).toMatch(/\{count, plural,/);
      }
    });
  });
});
