import {
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { THEME_IDS } from '@hk/ui-tokens/themes';
import { ThemeService, type Theme } from '@shared/services/theme/theme.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import type { UiIconName } from '../icons/vocabulary';

const THEME_ICON: Record<Theme, UiIconName> = {
  tavern: 'theme-tavern',
  scroll: 'theme-scroll',
  // No decoration: the minus sign stands for "taken away".
  plain: 'remove',
};

/**
 * `hk-theme-menu` — picks one of the three themes (tavern, scroll, plain) through `ThemeService`.
 * `inline` renders the radio group in place (the phone drawer); otherwise it is a Theme icon
 * button that opens the same group in a popover. The popover closes on Escape (focus returns to the
 * button), on a press outside it and after a theme is picked. In the group, the arrow keys move
 * between themes and apply them.
 */
@Component({
  selector: 'hk-theme-menu',
  imports: [TranslocoDirective, IconComponent, HkIconButtonComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './theme-menu.component.html',
  styleUrl: './theme-menu.component.scss',
  host: { '(keydown.escape)': 'onEscape()' },
})
export class HkThemeMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly themes = inject(ThemeService);
  private readonly trigger = viewChild<unknown, ElementRef<HTMLButtonElement>>('trigger', {
    read: ElementRef,
  });
  private readonly radios = viewChildren<ElementRef<HTMLButtonElement>>('radio');

  // Inputs
  readonly inline = input(false);

  protected readonly ids = THEME_IDS;
  protected readonly current = this.themes.theme;
  protected readonly open = signal(false);

  constructor() {
    // While open, a press anywhere outside closes the popover; the listener exists only then.
    effect((onCleanup) => {
      if (!this.open()) return;
      const onPress = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && this.host.contains(target)) return;
        this.open.set(false);
      };
      document.addEventListener('pointerdown', onPress);
      onCleanup(() => document.removeEventListener('pointerdown', onPress));
    });
  }

  protected icon(theme: Theme): UiIconName {
    return THEME_ICON[theme];
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected pick(theme: Theme): void {
    this.themes.setTheme(theme);
    if (!this.inline()) {
      this.open.set(false);
      this.trigger()?.nativeElement.focus();
    }
  }

  protected onEscape(): void {
    if (this.inline() || !this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }

  protected onArrow(event: Event, step: 1 | -1): void {
    event.preventDefault();
    const index = this.ids.indexOf(this.current());
    const next = this.ids[(index + step + this.ids.length) % this.ids.length];
    this.themes.setTheme(next);
    queueMicrotask(() => this.radios()[this.ids.indexOf(next)]?.nativeElement.focus());
  }
}
