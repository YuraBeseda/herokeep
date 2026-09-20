import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { fromEvent, map, merge } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@shared/services/auth/auth.service';
import { ThemeService } from '@shared/services/theme/theme.service';
import { UpdateService, WINDOW_RELOAD } from '@shared/services/pwa/update.service';
import { PackStore } from '@shared/stores/pack.store';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('shell')],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Properties
  protected readonly themeService = inject(ThemeService);
  protected readonly updateService = inject(UpdateService);
  // `PackStore.coreLoadFailed` — see its own doc comment — is what lets the shell replace the
  // router outlet with an actionable retry state instead of leaving a blank screen when the
  // core-pack fetch fails (a rejected `init()` used to leave `bootstrapApplication` unresolved).
  protected readonly packStore = inject(PackStore);
  // Shell account affordance (task-5-brief.md): a subtle Login link when logged out/unknown, a
  // username + Logout button when authed. `'unknown'` (AuthService.init()'s `GET /api/me` hasn't
  // settled yet — Global Constraints: never blocks boot) is treated the SAME as `'anon'` here,
  // same reasoning as `redirectAuthedGuard`'s own `'anon'`/`'unknown'` allow-list: there is
  // nothing to show for a not-yet-confirmed session except the logged-out affordance.
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly reload = inject(WINDOW_RELOAD);

  // Bridges `navigator.onLine` + the `online`/`offline` window events into a signal — small
  // enough at this size to live inline rather than as its own service.
  protected readonly isOnline = toSignal(
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline')).pipe(
      map(() => navigator.onLine),
    ),
    { initialValue: navigator.onLine },
  );

  // Reloads the page, re-running `bootstrapApplication` (and so `PackStore.init()`) from scratch
  // — simpler and more robust than re-driving just the failed fetch through partially-initialized
  // app state.
  protected retryInit(): void {
    this.reload();
  }

  // Ends the session then returns to the home route — logout's own tolerance contract
  // (`AuthService.logout`'s doc comment) means this always resolves, even offline.
  protected async onLogout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigate(['/']);
  }
}
