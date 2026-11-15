import { CdkTrapFocus } from '@angular/cdk/a11y';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkButtonComponent, type HkButtonVariant } from '../button/button.component';
import { HkFitLabelDirective } from '../fit-label/fit-label.directive';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { phoneLayout } from '../shell/viewport';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { ActionStrapService, type StrapAction } from './action-strap.service';

const VARIANT: Record<Exclude<StrapAction['kind'], 'icon'>, HkButtonVariant> = {
  primary: 'primary',
  parchment: 'parchment',
  // The strap is leather, so the ghost is the leather ghost.
  ghost: 'ghost-leather',
  ember: 'ember',
};

/**
 * `hk-action-strap` — the one fixed action bar at the bottom of every screen (design-system
 * ActionStrap, spec §3). Render it ONCE in the app shell; screens feed it through
 * `ActionStrapService`. Without a config it renders nothing and takes no height.
 *
 * Zones, left to right and in that order always: Exit, Primary, Secondary, then the status note.
 * Each action is keyed by its `id`, so a screen that sets a new config with the same ids keeps the
 * very same buttons in the same slots. On a phone (< 768 px) the actions become tiles and zone 3
 * collapses into a "More" tile that opens a sheet in the same order; the sheet closes on Escape
 * (focus returns to the tile), on a press outside it, and after an action is chosen.
 *
 * Label keys are full i18n keys. An `icon` action's label and reason must live in the `shell`
 * scope (`hk-icon-button` takes a shell hint key).
 */
@Component({
  selector: 'hk-action-strap',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    CdkTrapFocus,
    IconComponent,
    HkButtonComponent,
    HkFitLabelDirective,
    HkIconButtonComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './action-strap.component.html',
  styleUrl: './action-strap.component.scss',
  host: { '[class.hk-action-strap--empty]': '!config()' },
})
export class HkActionStrapComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly strap = inject(ActionStrapService);
  private readonly moreButton = viewChild<ElementRef<HTMLButtonElement>>('more');

  protected readonly config = this.strap.config;
  protected readonly phone: Signal<boolean> = phoneLayout();
  protected readonly sheetOpen = signal(false);

  constructor() {
    // A sheet for a strap that went away (navigation) or a layout that no longer collapses.
    effect(() => {
      if (!this.config() || !this.phone()) this.sheetOpen.set(false);
    });

    // While open, a press anywhere outside the sheet and its More tile closes it. The listener
    // exists only while open; the cleanup also runs on destroy.
    effect((onCleanup) => {
      if (!this.sheetOpen()) return;
      const onPress = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && this.host.contains(target)) {
          const inside = (target as Element).closest?.('.hk-astrap__sheet, .hk-astrap__more');
          if (inside) return;
        }
        this.sheetOpen.set(false);
      };
      document.addEventListener('pointerdown', onPress);
      onCleanup(() => document.removeEventListener('pointerdown', onPress));
    });
  }

  protected variant(action: StrapAction): HkButtonVariant {
    return VARIANT[action.kind === 'icon' ? 'ghost' : action.kind];
  }

  protected tileClass(action: StrapAction): string {
    return `hk-act hk-act--${action.kind}`;
  }

  /** Key of the hint an icon action shows: its reason while disabled with one, else its label. */
  protected hintKey(action: StrapAction): string {
    return action.disabled && action.disabledReason ? action.disabledReason : action.label;
  }

  protected toggleSheet(): void {
    this.sheetOpen.update((open) => !open);
  }

  protected closeSheet(): void {
    if (!this.sheetOpen()) return;
    this.sheetOpen.set(false);
    this.moreButton()?.nativeElement.focus();
  }

  /** Runs a tile or sheet action unless it is disabled. */
  protected activate(action: StrapAction): void {
    if (action.disabled) return;
    action.run();
  }

  protected runFromSheet(action: StrapAction): void {
    if (action.disabled) return;
    // Focus goes back first, so a dialog the action opens remembers the strap, not a removed item.
    this.closeSheet();
    action.run();
  }
}
