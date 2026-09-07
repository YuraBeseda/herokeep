import { Component, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export interface ToastMessage {
  readonly id: number;
  readonly key: string;
  readonly params?: Record<string, unknown>;
}

// The single host `ToastService` attaches to its overlay; it owns the visible toast queue as
// signal state and renders each entry's already-resolved-at-call-time key/params through the
// global (unscoped) Transloco lookup — see ToastService's SKILL.md for why that's safe.
@Component({
  selector: 'hk-toast',
  imports: [TranslocoDirective],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  host: {
    role: 'status',
    'aria-live': 'polite',
  },
})
export class ToastComponent {
  private readonly messages = signal<readonly ToastMessage[]>([]);
  protected readonly visible = this.messages.asReadonly();

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
