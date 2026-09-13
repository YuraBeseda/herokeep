import { Injectable, InjectionToken, Injector, type Type, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DialogComponent } from './dialog.component';

/** Injection token the component `DialogService.open()` opens can read its `data` from. */
export const DIALOG_DATA = new InjectionToken<unknown>('hk.DIALOG_DATA');

/** Close handle injected into the component a dialog opens, alongside `DIALOG_DATA`. */
export class DialogRef<R = unknown> {
  constructor(private readonly closeFn: (result?: R) => void) {}

  close(result?: R): void {
    this.closeFn(result);
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

    const dialogRef = new DialogRef(close);
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

    overlayRef.backdropClick().subscribe(() => close(undefined));
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(undefined);
      }
    });

    return { closed, close };
  }
}
