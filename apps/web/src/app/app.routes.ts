import { inject } from '@angular/core';
import type { ResolveFn, Routes } from '@angular/router';
import { CharactersRepository } from './shared/services/storage/characters.repository';
import { CharacterStore } from './shared/stores/character.store';

/**
 * `/c/:id`'s route-level resolver (plan-5 task-10-brief.md): checks `CharactersRepository.get`
 * first (a plain Dexie row lookup — cheap, and the authoritative "does this character exist at
 * all" check) before ever asking `CharacterStore` to replay its whole event stream, then awaits
 * `CharacterStore.load(id)`. Resolves `false` (never throws/redirects) for a missing row OR a
 * `load()` failure — `SheetShellComponent` reads this route data to render an i18n not-found
 * state instead of crashing on an undefined `sheet()`.
 */
export const characterResolver: ResolveFn<boolean> = async (route) => {
  const id = route.paramMap.get('id');
  if (!id) return false;

  // Both injected BEFORE the first `await` — `inject()` only works synchronously, within the
  // injection context the router sets up for this call; it's gone once a microtask boundary is
  // crossed (NG0203).
  const charactersRepository = inject(CharactersRepository);
  const characterStore = inject(CharacterStore);

  const row = await charactersRepository.get(id);
  if (!row) return false;

  try {
    await characterStore.load(id);
    return true;
  } catch {
    return false;
  }
};

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./views/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'characters/new',
    loadComponent: () =>
      import('./views/characters/create-wizard/create-wizard.component').then(
        (m) => m.CreateWizardComponent,
      ),
  },
  {
    path: 'characters',
    loadComponent: () =>
      import('./views/characters/list/characters-list.component').then(
        (m) => m.CharactersListComponent,
      ),
  },
  {
    path: 'c/:id',
    resolve: { characterFound: characterResolver },
    loadComponent: () =>
      import('./views/characters/sheet/sheet-shell.component').then((m) => m.SheetShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'play' },
      {
        path: 'play',
        loadComponent: () =>
          import('./views/characters/sheet/play/play-tab.component').then(
            (m) => m.PlayTabComponent,
          ),
      },
      {
        path: 'build',
        loadComponent: () =>
          import('./views/characters/sheet/build/build-tab.component').then(
            (m) => m.BuildTabComponent,
          ),
      },
      {
        path: 'timeline',
        loadComponent: () =>
          import('./views/characters/sheet/timeline/timeline-tab.component').then(
            (m) => m.TimelineTabComponent,
          ),
      },
    ],
  },
  {
    path: 'library',
    loadComponent: () =>
      import('./views/library/browse/browse.component').then((m) => m.LibraryBrowseComponent),
  },
  {
    path: 'library/:id',
    loadComponent: () =>
      import('./views/library/detail/detail.component').then((m) => m.LibraryDetailComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./views/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'about',
    loadComponent: () => import('./views/about/about.component').then((m) => m.AboutComponent),
  },
];
