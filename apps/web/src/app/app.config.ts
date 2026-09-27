import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  inject,
  provideAppInitializer,
  type ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { routes } from './app.routes';
import { BlobTransferService } from './shared/services/blob-transfer/blob-transfer.service';
import { CacheManagerService } from './shared/services/blob-transfer/cache-manager.service';
import { PartyOverviewPublisherService } from './shared/services/campaigns/party-overview-publisher.service';
import { AuthService } from './shared/services/auth/auth.service';
import { TranslocoHttpLoader } from './shared/services/i18n/transloco.loader';
import { SyncService } from './shared/services/sync/sync.service';
import { PackStore } from './shared/stores/pack.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideTransloco({
      config: {
        availableLangs: ['en', 'ru', 'uk'],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
    provideTranslocoMessageformat(),
    // Blocks bootstrap until `PackStore.init()` resolves (core pack fetch + Dexie translations
    // read), so every route's first render already has `EngineFacade.index/localizer/search`
    // populated — no per-view "loading packs" state needed. Chosen over lazily calling `init()`
    // from the first consumer because every Task 10+ view depends on content being present, the
    // core pack asset is small and PWA-precached (docs/02-architecture/09), and a single
    // app-shell loading moment is simpler to reason about than guarding every read of the
    // facade's computeds with `packStore.ready()`.
    provideAppInitializer(() => inject(PackStore).init()),
    // UNLIKE the PackStore initializer above, this one must NEVER block bootstrap (Global
    // Constraints: "the app NEVER blocks on the network at boot"; plan-8 design ruling 3:
    // `AuthService.init()` is "non-blocking, network-failure-tolerant"). `AuthService.init()`
    // deliberately returns `void`, not a `Promise` — calling it here (without `return`) fires the
    // `GET /api/me` check off in the background and lets bootstrap proceed immediately; the shell
    // renders in its `status() === 'unknown'` state until the request settles.
    provideAppInitializer(() => {
      inject(AuthService).init();
    }),
    // `SyncService` (task-8-brief.md) is `providedIn: 'root'` but otherwise never injected by
    // anything on the normal render path — `inject()`ing it here, once, at boot is what actually
    // instantiates it and runs its constructor's `effect()` (which is what watches
    // `AuthService.status`/`LeaderService.isLeader` and starts/stops sync sessions). No network
    // call happens merely by injecting it — same non-blocking contract as the `AuthService`
    // initializer immediately above (the effect only ever does anything once `AuthService.init()`
    // above resolves to `'authed'`).
    provideAppInitializer(() => {
      inject(SyncService);
    }),
    // `PartyOverviewPublisherService` (plan-10 task-8-brief.md, ruling 8): its constructor
    // subscribes `CharacterStore.onLocalAppend` — instantiating it here, once, at boot (the SAME
    // "inject() alone doesn't instantiate a nobody-else-injects service" reasoning as the
    // `SyncService` initializer immediately above) is what actually starts it watching for
    // campaign-linked characters' committed local appends, from app start, independent of
    // whichever route (if any) is currently showing a campaign's party grid.
    provideAppInitializer(() => {
      inject(PartyOverviewPublisherService);
    }),
    // `CacheManagerService`/`BlobTransferService` (plan-10 Task 13, doc-07 §Blob transfer +
    // §Cache management): same "inject() alone doesn't instantiate a nobody-else-injects service"
    // reasoning as the initializers above. `CacheManagerService` first (its constructor's boot-time
    // weekly orphan sweep and cap-loading are pure Dexie/Settings I/O, no network); then
    // `BlobTransferService`, whose own constructor effect starts watching
    // `SyncService.liveCampaignIds()` for campaign sessions to prefetch/serve blobs for. Order
    // doesn't affect correctness (Angular resolves the DI graph regardless), but mirrors the
    // dependency direction for readability.
    provideAppInitializer(() => {
      inject(CacheManagerService);
    }),
    provideAppInitializer(() => {
      inject(BlobTransferService);
    }),
    // Registered in every build (including dev serve) but only *enabled* outside dev mode — `ng
    // serve` has no `ngsw-worker.js` to fetch, and a stale cached dev bundle would be actively
    // confusing. `registerWhenStable:30000` defers registration until the app is stable (or 30s
    // pass, whichever first) so it never competes with first-paint/first-interaction work.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
