import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from '@shared/services/packs/canonical-json';
import { HkDb } from '@shared/services/storage/dexie.db';
import { LeaderService } from '@shared/services/storage/leader.service';
import { PacksRepository } from '@shared/services/storage/packs.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import { PackStore } from '@shared/stores/pack.store';
import {
  CampaignPackUploadMismatchError,
  CampaignPacksService,
  campaignPackKey,
} from './campaign-packs.service';
import type { EnabledPack } from './campaign-projection';

// --- fixtures -------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const sample = readPack(join(repoRoot, 'apps/web/src/testing/fixtures/packs/sample-content.json'));
/** A second, entity-free content pack — a campaign may enable several. */
const second: Pack = {
  ...sample,
  id: 'second-pack',
  name: 'Second pack',
  entities: [],
  assets: [],
};

const CAMPAIGN = '30000000-0000-4000-8000-000000000001';
const STREAM = `camp:${CAMPAIGN}`;

/** The body the server stores and serves for `pack` (Task 1: exactly its canonical JSON). */
function body(pack: Pack): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(pack));
}

/** The bare-hex digest `pack.enabled@1` carries. */
async function bareSha(bytes: Uint8Array): Promise<string> {
  return (await sha256Hex(bytes)).slice('sha256:'.length);
}

async function enabledEntry(pack: Pack): Promise<EnabledPack> {
  return { version: pack.version, sha256: await bareSha(body(pack)) };
}

function packUrl(packId: string, version: string): string {
  return `/api/campaigns/${CAMPAIGN}/packs/${packId}/${version}`;
}

// --- fakes for the two campaign seams (the real ones need a socket harness) ------------------------

class FakeSyncService {
  readonly live = signal<ReadonlySet<string>>(new Set());
  readonly liveCampaignIds: Signal<ReadonlySet<string>> = this.live.asReadonly();
}

class FakeCampaignStore {
  readonly enabled = signal<ReadonlyMap<string, ReadonlyMap<string, EnabledPack>>>(new Map());
  readonly enabledPacks = this.enabled.asReadonly();
  readonly appendToStream = vi.fn<CampaignStore['appendToStream']>().mockResolvedValue(undefined);

  setEnabled(campaignId: string, packs: Record<string, EnabledPack>): void {
    this.enabled.update((all) => new Map(all).set(campaignId, new Map(Object.entries(packs))));
  }
}

// --- server double ---------------------------------------------------------------------------------

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found', message: 'No such pack' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('CampaignPacksService', () => {
  const originalFetch = globalThis.fetch;
  let routes: Map<string, Route>;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let toastShow: ReturnType<typeof vi.fn>;
  let leaderState: WritableSignal<boolean>;
  let sync: FakeSyncService;
  let campaigns: FakeCampaignStore;

  beforeEach(async () => {
    routes = new Map();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const key = `${(init?.method ?? 'GET').toUpperCase()} ${requestUrl(input)}`;
      const route = routes.get(key);
      if (!route) return notFound();
      return route(init);
    });
    globalThis.fetch = fetchMock;
    toastShow = vi.fn();
    leaderState = signal(true);
    sync = new FakeSyncService();
    campaigns = new FakeCampaignStore();

    TestBed.configureTestingModule({
      providers: [
        { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(corePack) } },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: LeaderService, useValue: { isLeader: leaderState.asReadonly() } },
        { provide: SyncService, useValue: sync },
        { provide: CampaignStore, useValue: campaigns },
      ],
    });
    const db = TestBed.inject(HkDb);
    await Promise.all([db.packs.clear(), db.blobs.clear()]);
    await TestBed.inject(PackStore).init();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    TestBed.inject(HkDb).close();
  });

  function serve(pack: Pack, bytes: Uint8Array<ArrayBuffer> = body(pack)): void {
    routes.set(`GET ${packUrl(pack.id, pack.version)}`, () => new Response(bytes, { status: 200 }));
  }

  function gets(): string[] {
    return fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET')
      .map(([input]) => requestUrl(input));
  }

  async function stored(): Promise<{ packs: string[]; installed: string[]; blobs: number }> {
    return {
      packs: (await TestBed.inject(PacksRepository).getAll()).map((p) => `${p.id}@${p.version}`),
      installed: TestBed.inject(PackStore)
        .installedContent()
        .map((p) => `${p.id}@${p.version}`),
      blobs: await TestBed.inject(HkDb).blobs.count(),
    };
  }

  function statusOf(packId: string) {
    return TestBed.inject(CampaignPacksService).installStatus(CAMPAIGN)().get(packId);
  }

  // --- DM: enable / changeVersion / disable ----------------------------------------------------------

  describe('enable', () => {
    function acceptPut(pack: Pack): void {
      routes.set(`PUT ${packUrl(pack.id, pack.version)}`, async (init) =>
        Response.json({
          sha256: await bareSha(new TextEncoder().encode(init!.body as string)),
        }),
      );
    }

    it('PUTs the canonical pack JSON, then appends one pack.enabled carrying the bare-hex sha256', async () => {
      acceptPut(sample);
      const service = TestBed.inject(CampaignPacksService);

      await service.enable(CAMPAIGN, sample);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0];
      expect(requestUrl(input)).toBe(packUrl(sample.id, sample.version));
      expect(init?.method).toBe('PUT');
      expect(init?.body).toBe(canonicalJson(sample));
      expect(new Headers(init?.headers).get('X-Requested-With')).toBe('herokeep');
      const sha256 = await bareSha(body(sample));
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(campaigns.appendToStream).toHaveBeenCalledTimes(1);
      expect(campaigns.appendToStream).toHaveBeenCalledWith(STREAM, [
        {
          type: 'pack.enabled',
          v: 1,
          payload: { packId: sample.id, version: sample.version, sha256 },
        },
      ]);
    });

    it('refuses when the server stored a body with a different sha256: no event', async () => {
      routes.set(`PUT ${packUrl(sample.id, sample.version)}`, () =>
        Response.json({ sha256: 'f'.repeat(64) }),
      );

      const error = await TestBed.inject(CampaignPacksService)
        .enable(CAMPAIGN, sample)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CampaignPackUploadMismatchError);
      expect((error as CampaignPackUploadMismatchError).code).toBe('campaigns.packs.enable-failed');
      expect(campaigns.appendToStream).not.toHaveBeenCalled();
    });

    it('propagates a refused upload (quota) without appending an event', async () => {
      routes.set(`PUT ${packUrl(sample.id, sample.version)}`, () =>
        Response.json({ error: 'quota_exceeded', message: 'Quota exceeded' }, { status: 409 }),
      );

      await expect(
        TestBed.inject(CampaignPacksService).enable(CAMPAIGN, sample),
      ).rejects.toMatchObject({ status: 409, code: 'quota_exceeded' });
      expect(campaigns.appendToStream).not.toHaveBeenCalled();
    });

    it('refuses on a non-leader tab before uploading anything', async () => {
      leaderState.set(false);

      await expect(
        TestBed.inject(CampaignPacksService).enable(CAMPAIGN, sample),
      ).rejects.toBeInstanceOf(CampaignStoreNotLeaderError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(campaigns.appendToStream).not.toHaveBeenCalled();
    });

    it('changeVersion uploads the new version and enables it', async () => {
      const next: Pack = { ...sample, version: '1.0.1' };
      acceptPut(next);

      await TestBed.inject(CampaignPacksService).changeVersion(CAMPAIGN, next);

      expect(campaigns.appendToStream).toHaveBeenCalledWith(STREAM, [
        {
          type: 'pack.enabled',
          v: 1,
          payload: { packId: sample.id, version: '1.0.1', sha256: await bareSha(body(next)) },
        },
      ]);
    });
  });

  describe('disable', () => {
    it('appends pack.disabled naming the enabled version and digest', async () => {
      const entry = await enabledEntry(sample);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: entry });

      await TestBed.inject(CampaignPacksService).disable(CAMPAIGN, sample.id);

      expect(campaigns.appendToStream).toHaveBeenCalledWith(STREAM, [
        { type: 'pack.disabled', v: 1, payload: { packId: sample.id, ...entry } },
      ]);
    });

    it('is a no-op for a pack the campaign has not enabled', async () => {
      await TestBed.inject(CampaignPacksService).disable(CAMPAIGN, sample.id);

      expect(campaigns.appendToStream).not.toHaveBeenCalled();
    });
  });

  // --- member: automatic install ---------------------------------------------------------------------

  describe('member auto-install', () => {
    it('fetches, validates and installs an enabled pack the device lacks, once, with a toast', async () => {
      serve(sample);
      const installContent = vi.spyOn(TestBed.inject(PackStore), 'installContent');
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(() => statusOf(sample.id)?.state === 'installed');
      await settle();

      expect(gets()).toEqual([packUrl(sample.id, sample.version)]);
      expect(installContent).toHaveBeenCalledTimes(1);
      expect(installContent.mock.calls[0][0]).toEqual(sample);
      expect(installContent.mock.calls[0][1].size).toBe(0);
      expect(await stored()).toMatchObject({
        packs: ['sample-content@1.0.0'],
        installed: ['sample-content@1.0.0'],
      });
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith('campaigns.packs.installed', { name: sample.name });
      expect(TestBed.inject(CampaignPacksService).installErrors().size).toBe(0);
    });

    it('installs every enabled pack of a campaign joined with two (Review Focus 1)', async () => {
      serve(sample);
      serve(second);
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, {
        [sample.id]: await enabledEntry(sample),
        [second.id]: await enabledEntry(second),
      });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(
        () =>
          statusOf(sample.id)?.state === 'installed' && statusOf(second.id)?.state === 'installed',
      );

      expect((await stored()).packs.sort()).toEqual(['sample-content@1.0.0', 'second-pack@1.0.0']);
    });

    it('does not fetch or write when an identical pack is already installed', async () => {
      await TestBed.inject(PackStore).installContent(sample, new Map());
      const installContent = vi.spyOn(TestBed.inject(PackStore), 'installContent');
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));

      await settle();

      expect(statusOf(sample.id)).toEqual({ state: 'installed' });
      expect(gets()).toEqual([]);
      expect(installContent).not.toHaveBeenCalled();
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('refuses a body that does not match the event’s sha256 and stores NOTHING (Review Focus 1)', async () => {
      const tampered = new TextEncoder().encode(canonicalJson({ ...sample, name: 'Tampered' }));
      serve(sample, tampered);
      const installContent = vi.spyOn(TestBed.inject(PackStore), 'installContent');
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(() => statusOf(sample.id)?.state === 'error');

      expect(statusOf(sample.id)).toEqual({
        state: 'error',
        code: 'packs.import-failed-hash-mismatch',
      });
      expect(TestBed.inject(CampaignPacksService).installErrors()).toEqual(
        new Map([[campaignPackKey(CAMPAIGN, sample.id), 'packs.import-failed-hash-mismatch']]),
      );
      expect(installContent).not.toHaveBeenCalled();
      expect(await stored()).toEqual({ packs: [], installed: [], blobs: 0 });
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('records a conflict with a different pack under the same id@version and stores nothing', async () => {
      const other: Pack = { ...sample, name: 'Someone else’s sample' };
      await TestBed.inject(PackStore).installContent(other, new Map());
      serve(sample);
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(() => statusOf(sample.id)?.state === 'error');

      expect(statusOf(sample.id)).toEqual({ state: 'error', code: 'packs.import-failed-conflict' });
      const packs = await TestBed.inject(PacksRepository).getAll();
      expect(packs.map((p) => p.name)).toEqual(['Someone else’s sample']);
    });

    it('treats a missing body as retriable: a later version change of the enabled pack installs it', async () => {
      // Task 1's replace-on-PUT window: the welcome still names 1.0.0 while the server already
      // holds the 1.0.1 body, so GET 1.0.0 is a 404.
      const next: Pack = { ...sample, version: '1.0.1' };
      serve(next);
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(() => statusOf(sample.id)?.state === 'error');
      expect(statusOf(sample.id)).toEqual({
        state: 'error',
        code: 'campaigns.packs.install-failed-unavailable',
      });
      await settle();
      expect(gets()).toEqual([packUrl(sample.id, '1.0.0')]);

      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(next) });

      await waitFor(() => statusOf(sample.id)?.state === 'installed');
      expect((await stored()).packs).toEqual(['sample-content@1.0.1']);
    });

    it('retryInstall re-runs the fetch for a pack in error', async () => {
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });
      sync.live.set(new Set([CAMPAIGN]));
      await waitFor(() => statusOf(sample.id)?.state === 'error');
      serve(sample);

      await TestBed.inject(CampaignPacksService).retryInstall(CAMPAIGN, sample.id);

      expect(statusOf(sample.id)).toEqual({ state: 'installed' });
      expect((await stored()).packs).toEqual(['sample-content@1.0.0']);
      expect(TestBed.inject(CampaignPacksService).installErrors().size).toBe(0);
    });

    it('installs a pack whose dependency is another enabled pack, whichever arrives first', async () => {
      const dependent: Pack = {
        ...sample,
        dependencies: [...sample.dependencies, { id: second.id, range: '^1.0.0' }],
      };
      serve(dependent);
      // The dependency's body is held back until the dependent pack has failed validation, so
      // the dependent pack must be retried once the dependency is installed.
      routes.set(`GET ${packUrl(second.id, second.version)}`, async () => {
        // The fetch starts inside the service's effect; leave it before ticking the app.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await waitFor(() => statusOf(dependent.id)?.state === 'error');
        return new Response(body(second), { status: 200 });
      });
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, {
        [dependent.id]: await enabledEntry(dependent),
        [second.id]: await enabledEntry(second),
      });
      sync.live.set(new Set([CAMPAIGN]));

      await waitFor(
        () =>
          statusOf(dependent.id)?.state === 'installed' &&
          statusOf(second.id)?.state === 'installed',
      );

      expect((await stored()).packs.sort()).toEqual(['sample-content@1.0.0', 'second-pack@1.0.0']);
    });

    it('does nothing for a campaign without a live session', async () => {
      serve(sample);
      TestBed.inject(CampaignPacksService);
      campaigns.setEnabled(CAMPAIGN, { [sample.id]: await enabledEntry(sample) });

      await settle();

      expect(gets()).toEqual([]);
      expect((await stored()).packs).toEqual([]);
    });
  });

  it('every message code it surfaces has an en/ru/uk string', () => {
    const keys = [
      'campaigns.packs.installed',
      'campaigns.packs.install-failed-unavailable',
      'campaigns.packs.enable-failed',
      'packs.install-failed',
    ];
    for (const lang of ['en', 'ru', 'uk']) {
      for (const key of keys) {
        const [scope, ...path] = key.split('.');
        let node: unknown = JSON.parse(
          readFileSync(join(repoRoot, `apps/web/src/assets/i18n/${scope}/${lang}.json`), 'utf8'),
        );
        for (const segment of path) node = (node as Record<string, unknown>)[segment];
        expect(typeof node === 'string' && node.length > 0, `${lang}: ${key}`).toBe(true);
      }
    }
  });
});
