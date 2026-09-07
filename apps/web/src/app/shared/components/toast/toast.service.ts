import { Injectable, Injector, type ComponentRef, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ToastComponent, type ToastMessage } from './toast.component';

const MAX_VISIBLE = 3;
const DISMISS_MS = 4000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  // Dependencies
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);

  // State
  private hostRef: ComponentRef<ToastComponent> | null = null;
  private nextId = 0;
  private readonly pending: ToastMessage[] = [];

  // Methods

  show(key: string, params?: Record<string, unknown>): void {
    const message: ToastMessage = { id: this.nextId++, key, params };
    this.ensureHost();
    if (this.hostRef!.instance.count() < MAX_VISIBLE) {
      this.activate(message);
    } else {
      this.pending.push(message);
    }
  }

  private activate(message: ToastMessage): void {
    this.hostRef!.instance.push(message);
    setTimeout(() => this.dismiss(message.id), DISMISS_MS);
  }

  private dismiss(id: number): void {
    this.hostRef?.instance.remove(id);
    const next = this.pending.shift();
    if (next) {
      this.activate(next);
    }
  }

  private ensureHost(): void {
    if (this.hostRef) {
      return;
    }
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global().centerHorizontally().bottom('16px'),
      scrollStrategy: this.overlay.scrollStrategies.noop(),
    });
    this.hostRef = overlayRef.attach(new ComponentPortal(ToastComponent, null, this.injector));
  }
}
