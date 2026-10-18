import type { Routes } from '@angular/router';

/**
 * `/packs` child routes, lazy-loaded as one unit from `app.routes.ts` (`loadChildren`), so the
 * packs screens stay out of the initial bundle.
 *
 * Static paths must come BEFORE `:key`, which matches any single segment. Plan 15 Task 7 adds
 * `homebrew` (the quick-homebrew forms) at the marked slot below.
 */
export const PACKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./packs-list.component').then((m) => m.PacksListComponent),
  },
  // Task 7: `{ path: 'homebrew', loadComponent: … }` goes here, above `:key`.
  {
    path: ':key',
    loadComponent: () => import('./pack-detail.component').then((m) => m.PackDetailComponent),
  },
];
