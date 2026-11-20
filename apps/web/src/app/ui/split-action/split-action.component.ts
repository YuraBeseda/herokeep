import { Component, computed, input, signal } from '@angular/core';
import { TranslocoPipe, provideTranslocoScope } from '@jsverse/transloco';
import { HkButtonComponent, type HkButtonSize, type HkButtonVariant } from '../button/button.component';
import { HkMenuButtonComponent } from '../context-menu/menu-button.component';
import type { HkMenuItem } from '../context-menu/context-menu.types';
import { IconComponent } from '../../shared/icons/icon.component';

/**
 * `<hk-split-action [items] [storageKey] [defaultId]>` — one action that repeats the last-used item
 * (main button: icon + label, runs it) with a caret menu to switch. Choosing from the menu runs the
 * item and remembers its id in `localStorage` (`hk.split.<storageKey>`, per viewer). A fresh device,
 * an unknown id or storage that throws falls back to `defaultId`, so the button always names the
 * action it will apply.
 */
@Component({
  selector: 'hk-split-action',
  imports: [HkButtonComponent, HkMenuButtonComponent, IconComponent, TranslocoPipe],
  providers: [provideTranslocoScope('shell')],
  host: { class: 'hk-split' },
  template: `
    @let item = current();
    <button
      hk-button
      type="button"
      class="hk-split__main"
      [attr.data-split-id]="item.id"
      [variant]="variant()"
      [size]="size()"
      [disabledReason]="item.disabledReasonKey ? (item.disabledReasonKey | transloco) : null"
      (click)="item.run()"
    >
      @if (item.icon) {
        <hk-icon [icon]="item.icon" />
      }
      {{ item.labelKey | transloco }}
    </button>
    <hk-menu-button
      class="hk-split__caret"
      [items]="menuItems()"
      [label]="'shell.ui.split.switch' | transloco"
    />
  `,
  styleUrl: './split-action.component.scss',
})
export class HkSplitActionComponent {
  readonly items = input.required<HkMenuItem[]>();
  readonly storageKey = input.required<string>();
  readonly defaultId = input.required<string>();
  readonly variant = input<HkButtonVariant>('ghost-leather');
  readonly size = input<HkButtonSize>('m');

  private readonly chosen = signal<string | null>(null);

  private readonly id = computed(() => {
    const ids = this.items().map((i) => i.id);
    const wanted = this.chosen() ?? this.read();
    return wanted !== null && ids.includes(wanted) ? wanted : this.defaultId();
  });
  protected readonly current = computed(() => {
    const items = this.items();
    return items.find((i) => i.id === this.id()) ?? items[0];
  });
  protected readonly menuItems = computed(() =>
    this.items().map((i) => ({
      ...i,
      run: () => {
        this.remember(i.id);
        i.run();
      },
    })),
  );

  /** Runs the shown action unless it is disabled (Enter in an amount field). */
  runCurrent(): void {
    const item = this.current();
    if (!item.disabledReasonKey) item.run();
  }

  private key(): string {
    return `hk.split.${this.storageKey()}`;
  }

  private read(): string | null {
    try {
      return localStorage.getItem(this.key());
    } catch {
      return null;
    }
  }

  private remember(id: string): void {
    this.chosen.set(id);
    try {
      localStorage.setItem(this.key(), id);
    } catch {
      // Per-viewer convenience only; the choice still holds for this component's lifetime.
    }
  }
}
