import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { fromEvent, map, merge } from 'rxjs';
import { ThemeService } from '@shared/services/theme/theme.service';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslocoDirective],
  providers: [provideTranslocoScope('shell')],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Properties
  protected readonly themeService = inject(ThemeService);

  // Bridges `navigator.onLine` + the `online`/`offline` window events into a signal — small
  // enough at this size to live inline rather than as its own service.
  protected readonly isOnline = toSignal(
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline')).pipe(
      map(() => navigator.onLine),
    ),
    { initialValue: navigator.onLine },
  );
}
