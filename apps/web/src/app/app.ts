import { Component, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { fromEvent, map, merge } from 'rxjs';
import { UpdateService, WINDOW_RELOAD } from '@shared/services/pwa/update.service';
import { PackStore } from '@shared/stores/pack.store';
import { ActionStrapService } from './ui/action-strap/action-strap.service';
import { HkActionStrapComponent } from './ui/action-strap/action-strap.component';
import { HkBannerComponent } from './ui/banner/banner.component';
import { HkButtonComponent } from './ui/button/button.component';
import { HkPeekHostComponent } from './ui/description-drawer/peek-host.component';
import { PeekService } from './ui/description-drawer/peek.service';
import { NavHistoryService } from './ui/nav/nav-history.service';
import { currentSection } from './ui/shell/current-section';
import { sectionNameKey } from './ui/shell/sections';
import { HkNavRailComponent } from './ui/shell/nav-rail.component';
import { HkTopBarComponent } from './ui/shell/top-bar.component';
import { TopBarService } from './ui/shell/top-bar.service';
import { phoneLayout } from './ui/shell/viewport';
import { HkTabBarComponent } from './ui/tab-bar/tab-bar.component';
import { HkTexturesComponent } from './ui/textures/textures.component';

@Component({
  imports: [
    RouterOutlet,
    TranslocoDirective,
    HkTexturesComponent,
    HkNavRailComponent,
    HkTopBarComponent,
    HkActionStrapComponent,
    HkTabBarComponent,
    HkBannerComponent,
    HkButtonComponent,
    HkPeekHostComponent,
  ],
  // `provideTranslocoScope('sync')` lives HERE (the app-root, always-loaded shell) rather than on
  // any single view: `SyncService`'s toasts (task-8-brief.md) can fire from a background session
  // for a character no route currently has open, so the `sync` scope must already be loaded by
  // the time ANY toast can — same reasoning `characters-delete-confirm`'s own doc comment
  // (characters-list.component.ts) gives for relying on a scope loaded ahead of time.
  providers: [provideTranslocoScope('shell'), provideTranslocoScope('sync')],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Properties
  protected readonly updateService = inject(UpdateService);
  // `PackStore.coreLoadFailed` — see its own doc comment — is what lets the shell replace the
  // router outlet with an actionable retry state instead of leaving a blank screen when the
  // core-pack fetch fails (a rejected `init()` used to leave `bootstrapApplication` unresolved).
  protected readonly packStore = inject(PackStore);
  protected readonly topBar = inject(TopBarService);
  // The one description peek drawer (`hk-peek-host`), hosted here out of every transformed ancestor.
  protected readonly peek = inject(PeekService);
  private readonly router = inject(Router);
  private readonly reload = inject(WINDOW_RELOAD);
  private readonly navHistory = inject(NavHistoryService);

  // Phone (< 768 px): top bar and drawer instead of the rail; tablet and desktop: the rail.
  protected readonly phone = phoneLayout();
  protected readonly section = currentSection();
  protected readonly nameKey = sectionNameKey;

  // Bridges `navigator.onLine` + the `online`/`offline` window events into a signal — small
  // enough at this size to live inline rather than as its own service.
  protected readonly isOnline = toSignal(
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline')).pipe(
      map(() => navigator.onLine),
    ),
    { initialValue: navigator.onLine },
  );

  constructor() {
    // Instantiates the strap service at boot so its navigation safety net is always listening.
    inject(ActionStrapService);

    // The user's own path through the app, for every screen's Back (NavHistoryService).
    let trigger: NavigationStart['navigationTrigger'];
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        trigger = event.navigationTrigger;
      } else if (event instanceof NavigationEnd) {
        this.navHistory.push(event.urlAfterRedirects, trigger === 'popstate' ? 'traverse' : 'push');
      }
    });
  }

  // Reloads the page, re-running `bootstrapApplication` (and so `PackStore.init()`) from scratch
  // — simpler and more robust than re-driving just the failed fetch through partially-initialized
  // app state.
  protected retryInit(): void {
    this.reload();
  }
}
