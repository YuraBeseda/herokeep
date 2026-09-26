import { inject } from '@angular/core';
import type { CanActivateFn, CanDeactivateFn, ResolveFn, Routes } from '@angular/router';
import { Router } from '@angular/router';
import type { MembershipRole } from '@hk/protocol';
import { ToastService } from './shared/components/toast/toast.service';
import { apiJson } from './shared/services/api/api-fetch';
import { AuthService } from './shared/services/auth/auth.service';
import { CampaignsRepository } from './shared/services/storage/campaigns.repository';
import type { CampaignRow } from './shared/services/storage/dexie.db';
import { CharactersRepository } from './shared/services/storage/characters.repository';
import { CampaignStore } from './shared/stores/campaign.store';
import { CharacterStore } from './shared/stores/character.store';
import type { RegisterComponent } from './views/auth/register/register.component';

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

/**
 * `/c/:id/level-up`'s guard (plan-5 task-13-brief.md): refuses to activate the level-up wizard
 * while `CharacterStore.advancements()` is empty — reads it straight off the store rather than
 * re-parsing `:id` off the route (the parent `c/:id` route's own `characterResolver` has always
 * already run by the time a child route's guard does, so `characterStore`'s signals are already
 * pointed at this character) — redirecting back to the sheet's `play` tab with a toast instead.
 */
export const levelUpGuard: CanActivateFn = () => {
  const characterStore = inject(CharacterStore);
  const toastService = inject(ToastService);
  const router = inject(Router);

  if (characterStore.advancements().length > 0) return true;

  toastService.show('characters.levelUp.toast.noneAvailable');
  const id = characterStore.streamId();
  return router.createUrlTree(id ? ['/c', id, 'play'] : ['/characters']);
};

/**
 * `/login`, `/register`, `/recover`'s shared guard (task-4-brief.md): redirects an already-authed
 * user AWAY from the account screens to `/characters` — there is nothing for a logged-in user to
 * do there. `'anon'` and `'unknown'` both allow activation (the brief: "'anon'/'unknown' →
 * allow") — `'unknown'` matters because `AuthService.init()`'s `GET /api/me` check is
 * fire-and-forget (Global Constraints: "the app NEVER blocks on the network at boot"), so a user
 * who navigates straight to `/login` before that check resolves must still see the form, not be
 * stuck or bounced. This is intentionally the ONLY guard added by this task — no existing route
 * gains one (asserted in app.routes.spec.ts).
 */
export const redirectAuthedGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.status() === 'authed') {
    return router.createUrlTree(['/characters']);
  }
  return true;
};

/**
 * `/register`'s deactivation guard (task-5-brief.md): protects the ADR-012 recovery-codes step
 * from an accidental navigation away before the user has confirmed they saved the codes — they
 * are shown exactly once and never persisted client-side (`RegisterComponent`'s own header
 * comment). Purely a delegate to the component's own `canDeactivate()` (its doc comment has the
 * actual decision logic) — kept as a thin function here so `app.routes.ts` stays the one place
 * every route-level guard is wired, matching `redirectAuthedGuard`/`levelUpGuard` above.
 */
export const confirmRecoveryCodesGuard: CanDeactivateFn<RegisterComponent> = (component) =>
  component.canDeactivate();

/**
 * `/campaigns`, `/join(/:code)`, `/g/:id`'s shared guard (plan-10 task-6-brief.md): redirects an
 * anon user to `/login?returnUrl=<attempted url>` — `LoginComponent`'s own `returnUrl` handling
 * (this task) sends them back here after a successful sign-in. `'unknown'` is allowed through,
 * same posture as `redirectAuthedGuard`'s own `'anon'`/`'unknown'` table: `AuthService.init()`'s
 * `GET /api/me` check is fire-and-forget (Global Constraints — the app never blocks boot), so a
 * user who navigates straight to a campaign URL before that check resolves must still get a
 * chance to render, not be bounced on a guess. A genuinely anon user attempting a
 * campaign-scoped API call downstream (e.g. `campaignGuard`'s own `GET /api/campaigns`, or
 * `CampaignStore.create`/`.join`) still fails cleanly (401 / `CampaignStoreNotAuthenticatedError`)
 * — this guard is a UX shortcut, not the authorization boundary.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.status() === 'anon') {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  return true;
};

/** `campaigns.ts`'s minimal `GET /api/campaigns` DTO row shape (`apps/api/src/core/routes/
 * campaigns.ts`'s own `CampaignDto`) — duplicated here rather than imported (`apps/web` never
 * imports `apps/api`'s source, the same boundary `sync.service.ts`'s own `RemoteCampaignDto`
 * documents for the identical shape). */
interface RemoteCampaignDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly role: MembershipRole;
  readonly joinCode?: string;
}

/**
 * `/g/:id`'s membership guard (plan-10 task-6-brief.md): "membership known locally or fetched".
 * A `CampaignsRepository` row already cached for `:id` (the common case — created/joined on this
 * device, or seeded by `SyncService.reconcileCampaigns` on a prior login) is trusted outright, no
 * network call. Otherwise this fetches `GET /api/campaigns` (the same server-side membership
 * listing `SyncService`'s own reconciliation uses) and seeds a row FROM that response if `:id` is
 * in it — covering a fresh device / a campaign this device only ever saw a deep link for. No
 * membership found either way (including a network failure — there's nothing left to trust)
 * redirects to `/campaigns` with a toast; `CampaignStore.open()` is only ever called once
 * membership is established, so a stranger can never trigger even a READ of a campaign's local
 * event log. Route param `:id` is the BARE campaign id (`CampaignStore.campaignId()`'s own
 * convention), never the `camp:`-prefixed stream id.
 */
export const campaignGuard: CanActivateFn = async (route) => {
  const id = route.paramMap.get('id');
  const router = inject(Router);
  const toastService = inject(ToastService);
  if (!id) return router.createUrlTree(['/campaigns']);

  const campaignsRepository = inject(CampaignsRepository);
  const campaignStore = inject(CampaignStore);

  let row: CampaignRow | undefined = await campaignsRepository.get(id);
  if (!row) {
    try {
      const remoteRows = await apiJson<RemoteCampaignDto[]>('/api/campaigns');
      const found = remoteRows.find((r) => r.id === id);
      if (found) {
        row = {
          id: found.id,
          name: found.name,
          system: found.system,
          role: found.role,
          joinCode: found.joinCode,
          lastSeq: 0,
          updatedAt: Date.now(),
        };
        await campaignsRepository.put(row);
      }
    } catch {
      // Offline / server unreachable — nothing left to trust; falls through to the
      // not-a-member redirect below, same as a genuine "you aren't a member" response would.
    }
  }

  if (!row) {
    toastService.show('campaigns.guard.notMember');
    return router.createUrlTree(['/campaigns']);
  }

  try {
    await campaignStore.open(`camp:${id}`);
  } catch {
    // `open()` is local-storage-only I/O (Dexie reads) — a failure here should be unreachable in
    // practice, but mirrors `characterResolver`'s own defensive stance: fail the route rather than
    // throw out of a guard.
    toastService.show('campaigns.guard.notMember');
    return router.createUrlTree(['/campaigns']);
  }
  return true;
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
      {
        path: 'level-up',
        canActivate: [levelUpGuard],
        loadComponent: () =>
          import('./views/characters/level-up/level-up.component').then((m) => m.LevelUpComponent),
      },
    ],
  },
  {
    path: 'campaigns',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./views/campaigns/list/campaigns-list.component').then(
        (m) => m.CampaignsListComponent,
      ),
  },
  {
    path: 'join',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./views/campaigns/join/join.component').then((m) => m.JoinComponent),
  },
  {
    path: 'join/:code',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./views/campaigns/join/join.component').then((m) => m.JoinComponent),
  },
  {
    path: 'g/:id',
    canActivate: [authGuard, campaignGuard],
    loadComponent: () =>
      import('./views/campaigns/shell/campaign-shell.component').then(
        (m) => m.CampaignShellComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'party' },
      {
        path: 'party',
        loadComponent: () =>
          import('./views/campaigns/party/party-tab.component').then((m) => m.PartyTabComponent),
      },
      {
        path: 'log',
        loadComponent: () =>
          import('./views/campaigns/log/log-tab.component').then((m) => m.LogTabComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./views/campaigns/settings/campaign-settings.component').then(
            (m) => m.CampaignSettingsComponent,
          ),
      },
      {
        path: 'lobby',
        loadComponent: () =>
          import('./views/campaigns/lobby/lobby.component').then((m) => m.LobbyComponent),
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
  {
    path: 'login',
    canActivate: [redirectAuthedGuard],
    loadComponent: () => import('./views/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [redirectAuthedGuard],
    canDeactivate: [confirmRecoveryCodesGuard],
    loadComponent: () =>
      import('./views/auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'recover',
    canActivate: [redirectAuthedGuard],
    loadComponent: () =>
      import('./views/auth/recover/recover.component').then((m) => m.RecoverComponent),
  },
];
