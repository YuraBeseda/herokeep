import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { fromEvent, map, merge } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
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
}
