import { Component, inject, type Signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { phoneLayout } from '../shell/viewport';
import { TabBarService } from './tab-bar.service';

/**
 * `hk-tab-bar` — the phone's bottom leather tab bar (design-system Tabs). Render it ONCE in the app
 * shell; a screen with tabs feeds it through `TabBarService`. Renders nothing on tablet/desktop
 * (their tabs live on the folio) and nothing while no tabs are set. Tabs are real links, so a
 * deep link restores the exact tab and the current one follows the URL (`aria-current`).
 */
@Component({
  selector: 'hk-tab-bar',
  imports: [RouterLink, RouterLinkActive, TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
  host: { '[class.hk-tab-bar--hidden]': '!visible()' },
})
export class HkTabBarComponent {
  protected readonly tabs = inject(TabBarService).tabs;
  protected readonly phone: Signal<boolean> = phoneLayout();

  protected visible(): boolean {
    return this.phone() && !!this.tabs()?.length;
  }
}
