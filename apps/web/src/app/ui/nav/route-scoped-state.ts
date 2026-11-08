import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

const pathOf = (url: string): string => url.split(/[?#]/, 1)[0];

/** Whether `path` is the scope prefix itself or below it (segment-wise, so `/c/1` is not `/c/12`). */
function inScope(path: string, scope: readonly string[]): boolean {
  const prefix = scope
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * State a screen sets while it is open and the shell clears for it (the action strap, the phone top
 * bar). Call in an injection context. A navigation clears it when the target path leaves its
 * `scope` (a path prefix as segments; without a scope: when the path changes at all), so a stale
 * value never leaks to the next screen. A navigation that is then cancelled or fails puts it back.
 * Query-only and fragment-only changes never clear it.
 */
export function routeScopedState<T extends { readonly scope?: readonly string[] }>(): {
  readonly value: Signal<T | null>;
  set(value: T): void;
  clear(): void;
} {
  const router = inject(Router);
  const state = signal<T | null>(null);
  let committedPath = pathOf(router.url);
  let stash: T | null = null;

  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      const current = state();
      if (current === null) return;
      const target = pathOf(event.url);
      const stays = current.scope ? inScope(target, current.scope) : target === committedPath;
      if (!stays) {
        stash = current;
        state.set(null);
      }
    } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
      if (stash !== null && state() === null) state.set(stash);
      stash = null;
    } else if (event instanceof NavigationEnd) {
      committedPath = pathOf(router.url);
      stash = null;
    }
  });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

  return {
    value: state.asReadonly(),
    set(value: T): void {
      state.set(value);
      stash = null;
    },
    clear(): void {
      state.set(null);
      stash = null;
    },
  };
}
