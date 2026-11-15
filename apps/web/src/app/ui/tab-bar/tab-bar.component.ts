import { Component, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkFitLabelDirective } from '../fit-label/fit-label.directive';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { phoneLayout } from '../shell/viewport';
import { TabBarService, type TabItem } from './tab-bar.service';

/**
 * `hk-tab-bar` — the phone's bottom leather tab bar (design-system Tabs). Render it ONCE in the app
 * shell; a screen with tabs feeds it through `TabBarService`. Renders nothing on tablet/desktop
 * (their tabs live on the folio) and nothing while no tabs are set. Tabs are real links, so a
 * deep link restores the exact tab and the current one follows the URL (`aria-current`).
 */
@Component({
  selector: 'hk-tab-bar',
  imports: [RouterLink, TranslocoDirective, IconComponent, HkFitLabelDirective, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
  host: { '[class.hk-tab-bar--hidden]': '!visible()' },
})
export class HkTabBarComponent {
  protected readonly tabs = inject(TabBarService).tabs;
  protected readonly phone: Signal<boolean> = phoneLayout();

  private readonly router = inject(Router);
  /** The URL, re-read on every navigation so the "also active" marks follow it. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Whether the current route is the tab's own route or one it also stands for. */
  protected active(tab: TabItem): boolean {
    this.url();
    return [tab.route, ...(tab.alsoActive ?? [])].some((route) =>
      this.router.isActive(this.router.createUrlTree([...route]), {
        paths: 'subset',
        queryParams: 'ignored',
        fragment: 'ignored',
        matrixParams: 'ignored',
      }),
    );
  }

  protected visible(): boolean {
    return this.phone() && !!this.tabs()?.length;
  }
}
