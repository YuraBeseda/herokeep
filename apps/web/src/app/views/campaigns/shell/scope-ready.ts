import { inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { combineLatest, switchMap } from 'rxjs';

/**
 * Emits once the given `campaigns`-scope keys are translated, and again on every language change.
 * The strap and the tab bar translate their labels in the app shell, outside this scope's own
 * provider, and do not re-render when the lazy scope bundle arrives; an effect that reads this
 * signal sets them again at that moment, so a first visit never shows the raw keys (the sheet
 * shell does the same for its concentration note).
 */
export function campaignsScopeReady(keys: readonly string[]): Signal<unknown> {
  const transloco = inject(TranslocoService);
  return toSignal(
    transloco.langChanges$.pipe(
      switchMap(() =>
        combineLatest(keys.map((key) => transloco.selectTranslate(key, {}, 'campaigns'))),
      ),
    ),
    { initialValue: null },
  );
}
