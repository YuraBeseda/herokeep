import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkAppDrawerComponent } from './app-drawer.component';
import { TopBarService } from './top-bar.service';

/**
 * `hk-top-bar` — the phone's slim leather bar (design-system NavRail phone form, board
 * IA-Home-Phone): a folio button that opens the app drawer, the screen title, and a 44 px slot
 * kept free for the screen's one context action. Render it only on phones.
 *
 * It owns the drawer's dismissal: the same folio button closes it, so do Escape from the drawer or
 * the button (focus returns to the button), a press outside the drawer, and any router
 * `NavigationStart` (a link in it, browser or hardware Back). The drawer never changes the URL.
 */
@Component({
  selector: 'hk-top-bar',
  imports: [
    TranslocoDirective,
    IconComponent,
    HkIconButtonComponent,
    HkTooltipDirective,
    HkAppDrawerComponent,
  ],
  providers: [provideTranslocoScope('shell')],
  host: { '(keydown.escape)': 'close(true)' },
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.scss',
})
export class HkTopBarComponent {
  private readonly folio = viewChild.required<ElementRef<HTMLButtonElement>>('folio');

  // Inputs
  /** Already-translated screen title; long titles ellipsise with the full text as a hint. */
  readonly title = input.required<string>();

  private readonly topBar = inject(TopBarService);
  protected readonly action = computed(() => this.topBar.config()?.action);
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

    const navigations = inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) this.close(false);
    });
    inject(DestroyRef).onDestroy(() => navigations.unsubscribe());
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
