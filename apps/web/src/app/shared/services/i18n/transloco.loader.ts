import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

// Transloco composes scoped loads into a single `<scope>/<lang>` path (e.g. `shell/en`) before
// calling the loader, and an unscoped load passes the bare lang (e.g. `en`) — in both cases the
// same `assets/i18n/${langPath}.json` shape resolves correctly, since `src/assets/**` is served
// at `/assets/**` (see angular.json).
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(langPath: string) {
    return this.http.get<Translation>(`assets/i18n/${langPath}.json`);
  }
}
