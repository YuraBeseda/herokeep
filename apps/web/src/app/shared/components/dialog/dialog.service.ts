import { Injectable, InjectionToken, Injector, type Type, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DialogComponent } from './dialog.component';

/** Injection token the component `DialogService.open()` opens can read its `data` from. */
export const DIALOG_DATA = new InjectionToken<unknown>('hk.DIALOG_DATA');

/** Close handle injected into the component a dialog opens, alongside `DIALOG_DATA`. */
export class DialogRef<R = unknown> {
  constructor(
    private readonly closeFn: (result?: R) => void,
    private readonly setDismissibleFn: (dismissible: boolean) => void = () => undefined,
  ) {}

  close(result?: R): void {
    this.closeFn(result);
  }

  /**
   * Blocks ESC/backdrop-click dismissal while `dismissible` is `false` — the TWO passive
   * dismissal paths `DialogService.open()` wires up itself. The opened component's own explicit
   * `close()` calls (a Cancel/Confirm button, `resolveClosed` reached some other way) are NEVER
   * affected by this flag; it exists purely to stop an in-flight, multi-step operation from being
   * silently abandoned mid-way (plan-10 task-7 fix round 1: a campaign leave sequence that has
   * already committed step (a) but not yet step (b) — dismissing the dialog there would strand
   * the character in a half-left state with no visible way back in). Defaults to dismissible;
   * every OTHER existing dialog never calls this and is unaffected.
   */
  setDismissible(dismissible: boolean): void {
    this.setDismissibleFn(dismissible);
  }
}

export interface DialogOptions {
  readonly data?: unknown;
  readonly sheet?: boolean;
  /** Fallback accessible name for a dialog whose content has no `[data-dialog-title]` element —
   * see `DialogComponent`'s own class doc. Every current consumer has a title element, so no
   * caller passes this today; it exists so a future title-less dialog still has a way to be
   * accessibly named instead of silently shipping without one. */
  readonly ariaLabel?: string;
}

export interface DialogHandle {
  readonly closed: Promise<unknown>;
  close(result?: unknown): void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  // Dependencies
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);

  // Methods

  open<T>(component: Type<T>, opts?: DialogOptions): DialogHandle {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const positionStrategy = opts?.sheet
      ? this.overlay.position().global().centerHorizontally().bottom('0')
      : this.overlay.position().global().centerHorizontally().centerVertically();

    const overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.block(),
      hasBackdrop: true,
      backdropClass: 'hk-overlay-backdrop',
      width: opts?.sheet ? '100%' : undefined,
    });

    let resolveClosed!: (result: unknown) => void;
    const closed = new Promise<unknown>((resolve) => {
      resolveClosed = resolve;
    });

    let isClosed = false;
    const close = (result?: unknown): void => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      overlayRef.dispose();
      previouslyFocused?.focus();
      resolveClosed(result);
    };

    // `DialogRef.setDismissible` (plan-10 task-7 fix round 1) — plain closure state, read by the
    // backdrop/ESC subscriptions below; the opened component's own `close()` calls never consult
    // it at all (they call `close` directly, not through this flag).
    let dismissible = true;
    const dialogRef = new DialogRef(close, (value) => {
      dismissible = value;
    });
    const contentInjector = Injector.create({
      parent: this.injector,
      providers: [
        { provide: DIALOG_DATA, useValue: opts?.data },
        { provide: DialogRef, useValue: dialogRef },
      ],
    });
    const contentPortal = new ComponentPortal(component, null, contentInjector);

    const shellRef = overlayRef.attach(new ComponentPortal(DialogComponent));
    shellRef.setInput('contentPortal', contentPortal);
    shellRef.setInput('sheet', !!opts?.sheet);
    shellRef.setInput('ariaLabel', opts?.ariaLabel);

    overlayRef.backdropClick().subscribe(() => {
      if (dismissible) close(undefined);
    });
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismissible) close(undefined);
      }
    });

    return { closed, close };
  }
}
