import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Component, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkContextMenuComponent } from './context-menu.component';
import { type HkMenuItems, resolveMenuItems } from './context-menu.types';

/**
 * `<hk-menu-button [items]>` — the visible `⋯` button that opens the same menu as `[hkContextMenu]`
 * (CDK `CdkMenuTrigger`: click, Enter/Space, arrow keys; Escape returns focus here). Icon-only, so
 * it carries an accessible name and the same text as its hint; `label` overrides the default
 * "More actions" with already-translated text (e.g. "Actions for Longsword").
 */
@Component({
  selector: 'hk-menu-button',
  imports: [
    CdkMenuTrigger,
    IconComponent,
    HkTooltipDirective,
    HkContextMenuComponent,
    TranslocoDirective,
  ],
  providers: [provideTranslocoScope('shell')],
  template: `
    <hk-context-menu #menu />
    <ng-container *transloco="let t; read: 'shell'">
      @let name = label() ?? t('ui.menu.more');
      <button
        type="button"
        class="hk-menu-button"
        [cdkMenuTriggerFor]="menu.template()"
        (cdkMenuOpened)="menu.items.set(resolve())"
        [attr.aria-label]="name"
        [hkTooltip]="name"
      >
        @if (icon(); as glyph) {
          <hk-icon [icon]="glyph" />
        } @else {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        }
      </button>
    </ng-container>
  `,
  styleUrl: './menu-button.component.scss',
})
export class HkMenuButtonComponent {
  readonly items = input.required<HkMenuItems>();
  /** Translated accessible name and hint; `null` uses "More actions". */
  readonly label = input<string | null>(null);
  /** Sprite id shown instead of the dots (the attack row's dice button). */
  readonly icon = input<string | null>(null);

  protected resolve() {
    return resolveMenuItems(this.items());
  }
}
