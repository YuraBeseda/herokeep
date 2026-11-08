import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

const MAX_ENTRIES = 50;

const pathOf = (url: string): string => url.split(/[?#]/, 1)[0];

/**
 * The user's own path through the app (spec §2.3 "Back"). The shell records every committed
 * in-app URL here (`push`, from the router's `NavigationEnd`); a screen's Back calls
 * `back(fallback)`, which returns to the previous distinct path or, with no history (a deep link,
 * a fresh load), goes to the screen's parent in the app map.
 *
 * Entries are compared by path: a query-only or fragment-only change replaces the current entry
 * instead of stacking one. A browser Back/Forward traversal (`'traverse'`) that lands on the
 * previous entry pops the stack rather than growing it.
 */
@Injectable({ providedIn: 'root' })
export class NavHistoryService {
  private readonly router = inject(Router);

  private readonly stack = signal<readonly string[]>([]);
  /** Path (no query or fragment) of the screen the user is on; empty before the first navigation. */
  readonly currentPath = computed(() => pathOf(this.stack().at(-1) ?? ''));
  /** Whether Back has an earlier in-app screen to return to. */
  readonly canGoBack = computed(() => this.stack().length > 1);

  push(url: string, kind: 'push' | 'traverse' = 'push'): void {
    const stack = [...this.stack()];
    const top = stack.at(-1);
    if (top !== undefined && pathOf(top) === pathOf(url)) {
      stack[stack.length - 1] = url;
    } else if (kind === 'traverse' && stack.length > 1 && pathOf(stack.at(-2)!) === pathOf(url)) {
      stack.pop();
      stack[stack.length - 1] = url;
    } else {
      stack.push(url);
    }
    this.stack.set(stack.slice(-MAX_ENTRIES));
  }

  back(fallback: readonly string[]): void {
    const stack = [...this.stack()];
    if (stack.length > 1) {
      stack.pop();
      this.stack.set(stack);
      void this.router.navigateByUrl(stack[stack.length - 1]);
      return;
    }
    void this.router.navigate([...fallback]);
  }
}
