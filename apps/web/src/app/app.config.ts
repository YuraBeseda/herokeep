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
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { routes } from './app.routes';
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
  ],
};
