import type { Routes } from '@angular/router';

/**
 * `/packs` child routes, lazy-loaded as one unit from `app.routes.ts` (`loadChildren`), so the
 * packs screens stay out of the initial bundle.
 *
 * Static paths must come BEFORE `:key`, which matches any single segment. Plan 15 Task 7: the
 * quick-homebrew screens are routes (not dialogs) — the list at `homebrew`, a form at
 * `homebrew/new/:type` and `homebrew/edit/:type/:slug` (type and slug of a `homebrew:<type>/<slug>`
 * id, so no encoded `:`/`/` in the URL) — each lazily loaded.
 */
export const PACKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./packs-list.component').then((m) => m.PacksListComponent),
  },
  {
    path: 'homebrew',
    loadComponent: () =>
      import('./homebrew/homebrew-list.component').then((m) => m.HomebrewListComponent),
  },
  {
    path: 'homebrew/new/:type',
    loadComponent: () =>
      import('./homebrew/homebrew-editor.component').then((m) => m.HomebrewEditorComponent),
  },
  {
    path: 'homebrew/edit/:type/:slug',
    loadComponent: () =>
      import('./homebrew/homebrew-editor.component').then((m) => m.HomebrewEditorComponent),
  },
  {
    path: ':key',
    loadComponent: () => import('./pack-detail.component').then((m) => m.PackDetailComponent),
  },
];
