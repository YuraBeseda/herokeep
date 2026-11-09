import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { TranslocoService } from '@jsverse/transloco';
import { filter, map, merge } from 'rxjs';

/**
 * A key's text as a signal that updates when the language changes or a translation scope finishes
 * loading, for strings that go to a place a template cannot reach (the action strap's note). Call it
 * in an injection context; the key's scope must be one the calling view provides.
 */
export function translated(transloco: TranslocoService, key: string): Signal<string> {
  const read = (): string => transloco.translate(key);
  return toSignal(
    merge(
      transloco.langChanges$,
      transloco.events$.pipe(filter((event) => event.type === 'translationLoadSuccess')),
    ).pipe(map(read)),
    { initialValue: read() },
  );
}
