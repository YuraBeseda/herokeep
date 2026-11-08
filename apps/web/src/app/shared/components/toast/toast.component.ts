import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { phoneLayout } from '../../../ui/shell/viewport';
import { TabBarService } from '../../../ui/tab-bar/tab-bar.service';
import { HkToastComponent } from '../../../ui/toast/toast.component';

export interface ToastMessage {
  readonly id: number;
  readonly key: string;
  readonly params?: Record<string, unknown>;
}

// The single host `ToastService` attaches to its overlay; it owns the visible toast queue as
// signal state and renders each entry's already-resolved-at-call-time key/params through the
// global (unscoped) Transloco lookup — see ToastService's SKILL.md for why that's safe.
@Component({
  selector: 'hk-toast-host',
  imports: [TranslocoDirective, HkToastComponent],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  host: {
    role: 'status',
    'aria-live': 'polite',
    '[class.hk-toast-host--strap]': 'strapShown()',
    '[class.hk-toast-host--tabs]': 'tabsShown()',
  },
})
export class ToastComponent {
  private readonly messages = signal<readonly ToastMessage[]>([]);
  protected readonly visible = this.messages.asReadonly();

  // The shell's dock reserves the action strap's and the phone tab bar's height; the host lifts
  // the slips above exactly what is on screen (the same two signals the strap and tab bar read).
  private readonly strap = inject(ActionStrapService);
  private readonly tabBar = inject(TabBarService);
  private readonly phone = phoneLayout();
  protected readonly strapShown = computed(() => this.strap.config() !== null);
  protected readonly tabsShown = computed(() => this.phone() && !!this.tabBar.tabs()?.length);

  // Methods

  push(message: ToastMessage): void {
    this.messages.update((list) => [...list, message]);
  }

  remove(id: number): void {
    this.messages.update((list) => list.filter((message) => message.id !== id));
  }

  count(): number {
    return this.messages().length;
  }
}
