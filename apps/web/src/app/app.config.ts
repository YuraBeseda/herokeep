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
import { AuthService } from './shared/services/auth/auth.service';
import { TranslocoHttpLoader } from './shared/services/i18n/transloco.loader';
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
