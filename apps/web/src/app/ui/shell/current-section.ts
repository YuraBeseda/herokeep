import { computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { sectionOfPath, type ShellSection } from './sections';

const pathOf = (url: string): string => url.split(/[?#]/, 1)[0];

/** The section the router is on (a hero or campaign sub-route counts for its section). Call in an injection context. */
export function currentSection(): Signal<ShellSection | null> {
  const router = inject(Router);
  const path = signal(pathOf(router.url));
  router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
    if (event instanceof NavigationEnd) path.set(pathOf(event.urlAfterRedirects));
  });
  return computed(() => sectionOfPath(path()));
}
