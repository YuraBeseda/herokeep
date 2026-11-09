import { Injectable, signal, type Signal } from '@angular/core';

/** The DM quick effects: the strap offers the first five, the party cards' chips all nine. */
export type DmEffectKind =
  'damage' | 'heal' | 'temp' | 'condition' | 'xp' | 'level' | 'item' | 'inspiration' | 'override';

export interface SelectedMember {
  readonly characterId: string;
  readonly name: string;
}

export interface EffectRequest {
  readonly kind: DmEffectKind;
  readonly characterId: string;
  /** Distinguishes two identical requests in a row. */
  readonly nonce: number;
}

/**
 * Which party member the DM has picked, and the strap's pending request to act on them. The strap
 * (campaign shell, zone 2) cannot reach the quick-effects leaf, so it posts a request here and the
 * leaf of the addressed member picks it up: the same actions the leaf's own tabs run. The
 * shell clears both when the campaign closes.
 */
@Injectable({ providedIn: 'root' })
export class CampaignSelectionService {
  private readonly selectedState = signal<SelectedMember | null>(null);
  private readonly requestState = signal<EffectRequest | null>(null);
  private nonce = 0;

  readonly selected: Signal<SelectedMember | null> = this.selectedState.asReadonly();
  readonly request: Signal<EffectRequest | null> = this.requestState.asReadonly();

  select(member: SelectedMember): void {
    this.selectedState.set(member);
    // A request belongs to the selection that made it.
    this.requestState.set(null);
  }

  /** Selects the member, or drops the selection when they are already the selected one. */
  toggle(member: SelectedMember): void {
    this.selectedState.update((current) =>
      current?.characterId === member.characterId ? null : member,
    );
    this.requestState.set(null);
  }

  /** A request is acted on once: the leaf that handles it takes it off the board. */
  consume(request: EffectRequest): void {
    if (this.requestState() === request) this.requestState.set(null);
  }

  clear(): void {
    this.selectedState.set(null);
    this.requestState.set(null);
  }

  /** Asks the selected member's quick-effects leaf to open `kind`. Nothing happens with no selection. */
  requestEffect(kind: DmEffectKind): void {
    const member = this.selectedState();
    if (!member) return;
    this.requestState.set({ kind, characterId: member.characterId, nonce: ++this.nonce });
  }
}
