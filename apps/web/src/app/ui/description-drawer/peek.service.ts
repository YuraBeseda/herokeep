import { DestroyRef, Injectable, signal, type Injector, type TemplateRef } from '@angular/core';

/** A pack entity id, e.g. `srd-5e-2024:feature/paladin-lay-on-hands`. */
export type EntityId = string;

/** Where the peek is read from: the caller's injector (hero or wizard scope) and its actions. */
export interface PeekContext {
  /** The drawer resolves its providers here first (`CharacterEngineScope`, `CreateWizardState`, the engine scope). */
  readonly injector?: Injector;
  /** Rendered in the drawer's footer, in the caller's own template context. */
  readonly actions?: TemplateRef<unknown>;
}

export interface Peek {
  readonly entityId: EntityId;
  /** The control that opened the peek: focus returns to it when the drawer closes. */
  readonly opener?: HTMLElement;
  readonly ctx?: PeekContext;
}

/**
 * The one description peek: `app.html` hosts the only `hk-description-drawer` and renders
 * `current` under `ctx.injector`. Opening another entity while one is open replaces the content
 * (never a second drawer) and keeps the first opener unless a new one is given. The host lives at
 * the app root, so no transformed ancestor (a tilted leaf) can become the fixed panel's containing
 * block. A peek whose caller is destroyed (a wizard step left) closes with it.
 */
@Injectable({ providedIn: 'root' })
export class PeekService {
  private readonly state = signal<Peek | null>(null);
  readonly current = this.state.asReadonly();
  /** Unregisters the close-on-destroy hook of the caller now shown (one at a time, never piling up). */
  private unwatch: (() => void) | undefined;

  open(entityId: EntityId, opener?: HTMLElement, ctx?: PeekContext): void {
    this.unwatch?.();
    this.state.update((open) => ({ entityId, opener: opener ?? open?.opener, ctx }));
    this.unwatch = ctx?.injector?.get(DestroyRef, null)?.onDestroy(() => {
      this.unwatch = undefined;
      this.close();
    });
  }

  close(): void {
    this.unwatch?.();
    this.unwatch = undefined;
    this.state.set(null);
  }
}
