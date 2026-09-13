import type { Routes } from '@angular/router';

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
