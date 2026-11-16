import { ViewportScroller } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
  Scroll,
} from '@angular/router';

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
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly scrolls = new Map<string, { page: [number, number]; list?: number }>();
  /** The entry on screen (the one a navigation leaves); `back()` pops the stack before it starts. */
  private shown?: string;
  private backing = false;
  private pendingList?: number;
  private listSource?: () => number;

  private readonly stack = signal<readonly string[]>([]);
  /** Path (no query or fragment) of the screen the user is on; empty before the first navigation. */
  readonly currentPath = computed(() => pathOf(this.stack().at(-1) ?? ''));
  /** Whether Back has an earlier in-app screen to return to. */
  readonly canGoBack = computed(() => this.stack().length > 1);

  push(url: string, kind: 'push' | 'traverse' = 'push'): void {
    this.shown = url;
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

  constructor() {
    // Remember where each entry was scrolled to when it was left (in memory only), and arm the
    // list restore for a back or browser-Back arrival; a forward navigation starts at the top.
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationStart)) return;
      if (this.shown !== undefined) {
        this.scrolls.set(this.shown, {
          page: this.viewportScroller.getScrollPosition(),
          list: this.listSource?.(),
        });
      }
      if (event.navigationTrigger === 'popstate')
        this.pendingList = this.scrolls.get(event.url)?.list;
      else if (!this.backing) this.pendingList = undefined;
      this.backing = false;
    });
  }

  /** A virtual list reports its scroll offset here while it is on screen. */
  registerListScroll(source: () => number): () => void {
    this.listSource = source;
    return () => {
      if (this.listSource === source) this.listSource = undefined;
    };
  }

  /** The list offset to restore for the screen just entered by Back; one-shot. */
  takeListScroll(): number | undefined {
    const offset = this.pendingList;
    this.pendingList = undefined;
    return offset;
  }

  back(fallback: readonly string[]): void {
    const stack = [...this.stack()];
    if (stack.length > 1) {
      stack.pop();
      this.stack.set(stack);
      const target = stack[stack.length - 1];
      const saved = this.scrolls.get(target);
      this.backing = true;
      this.pendingList = saved?.list;
      this.restoreScrollAfterNavigation(saved?.page);
      void this.router.navigateByUrl(target);
      return;
    }
    void this.router.navigate([...fallback]);
  }

  /**
   * `navigateByUrl` is not a popstate navigation, so the router scrolls to the top. Restores the saved position once
   * the router has scrolled for this navigation.
   */
  private restoreScrollAfterNavigation(position: [number, number] | undefined): void {
    if (!position) return;
    let id: number | undefined;
    const sub = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        id ??= event.id;
      } else if (event instanceof Scroll && event.routerEvent.id === id) {
        // A microtask later, so it lands after the router's own scroll-to-top for this event.
        queueMicrotask(() => this.viewportScroller.scrollToPosition(position));
        sub.unsubscribe();
      } else if (
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
      ) {
        sub.unsubscribe();
      }
    });
  }
}
