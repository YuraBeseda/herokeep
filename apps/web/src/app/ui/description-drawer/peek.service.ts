import { Injectable, signal } from '@angular/core';

/** A pack entity id, e.g. `srd-5e-2024:feature/paladin-lay-on-hands`. */
export type EntityId = string;

export interface Peek {
  readonly entityId: EntityId;
  /** The control that opened the peek: focus returns to it when the drawer closes. */
  readonly opener?: HTMLElement;
}

/**
 * The one description peek: `app.html` hosts the only `hk-description-drawer` and renders
 * `current`. Opening another entity while one is open replaces the content (never a second drawer)
 * and keeps the first opener unless a new one is given. The host lives at the app root, so no
 * transformed ancestor (a tilted leaf) can become the fixed panel's containing block.
 */
@Injectable({ providedIn: 'root' })
export class PeekService {
  private readonly state = signal<Peek | null>(null);
  readonly current = this.state.asReadonly();

  open(entityId: EntityId, opener?: HTMLElement): void {
    this.state.update((open) => ({ entityId, opener: opener ?? open?.opener }));
  }

  close(): void {
    this.state.set(null);
  }
}
