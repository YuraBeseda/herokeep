import { Component, effect, input, signal, viewChild, type ElementRef } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkAppDrawerComponent } from './app-drawer.component';

/**
 * `hk-top-bar` — the phone's slim leather bar (design-system NavRail phone form, board
 * IA-Home-Phone): a folio button that opens the app drawer, the screen title, and a 44 px slot
 * kept free for the screen's one context action. Render it only on phones.
 *
 * It owns the drawer's dismissal: the same folio button closes it, so do Escape (focus returns to
 * the button), a press outside the drawer, and following a link in it. The drawer never changes
 * the URL.
 */
@Component({
  selector: 'hk-top-bar',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective, HkAppDrawerComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.scss',
})
export class HkTopBarComponent {
  private readonly folio = viewChild.required<ElementRef<HTMLButtonElement>>('folio');

  // Inputs
  /** Already-translated screen title; long titles ellipsise with the full text as a hint. */
  readonly title = input.required<string>();

  protected readonly open = signal(false);

  constructor() {
    // While open, a press anywhere outside the drawer and the folio button closes it. The listener
    // exists only while open; the cleanup also runs on destroy.
    effect((onCleanup) => {
      if (!this.open()) return;
      const onPress = (event: Event): void => {
        const target = event.target;
        if (target instanceof Element && target.closest('hk-app-drawer, .hk-topbar__folio')) return;
        this.open.set(false);
      };
      document.addEventListener('pointerdown', onPress);
      onCleanup(() => document.removeEventListener('pointerdown', onPress));
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.folio().nativeElement.focus();
  }
}
