import { Component, computed, input, output, signal } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { HkButtonComponent } from '../button/button.component';
import { HkNumberFieldComponent } from '../number-field/number-field.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';

export interface CoinPurse {
  readonly pp: number;
  readonly gp: number;
  readonly sp: number;
  readonly cp: number;
  /** Electrum is optional: supply it to let the player see (when non-zero) and edit it. */
  readonly ep?: number;
}

const METALS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
export type CoinMetal = (typeof METALS)[number];

/** The disc colours of a metal: CSS custom properties of the design tokens. */
const DISC: Record<CoinMetal, { top: string; shade: string }> = {
  pp: { top: 'var(--coin-platinum)', shade: 'var(--coin-platinum-shade)' },
  gp: { top: 'var(--coin-gold)', shade: 'var(--coin-gold-shade)' },
  sp: { top: 'var(--coin-silver)', shade: 'var(--coin-silver-shade)' },
  cp: { top: 'var(--coin-copper)', shade: 'var(--coin-copper-shade)' },
  // Electrum is a gold-silver alloy with no token of its own: gold face over the silver edge, a
  // pairing neither gp (gold/gold) nor sp (silver/silver) uses, so the stacks stay distinguishable.
  ep: { top: 'var(--coin-gold)', shade: 'var(--coin-silver-shade)' },
};

/** Ellipse centres of the six stacked discs, bottom to top. */
const DISC_ROWS = [23, 19.5, 16, 12.5, 9, 5.5] as const;

/**
 * `hk-coin-pouch` — the purse (design-system CoinPouch): a drawstring pouch beside four stacked
 * coin discs (platinum, gold, silver, copper) with their counts, the total in gold and an edit
 * button.
 *
 * It displays the amounts it is given. The total is a number the caller supplies (what coins
 * are worth is a rule, not drawn here). Each stack is an image whose name speaks the amount and
 * the metal ("38 gold pieces"); the metal is told by the word and the abbreviation, never by the
 * disc colour alone. A zero stack still shows.
 *
 * The edit button turns each metal into an `hk-number-field` (min 0) on a draft copy; Save emits
 * the four amounts once through `save` and returns to the view, Cancel returns without emitting.
 * `edit` also fires when editing starts. Spending a sum and making change is the caller's.
 */
@Component({
  selector: 'hk-coin-pouch',
  imports: [TranslocoDirective, HkIconButtonComponent, HkNumberFieldComponent, HkButtonComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './coin-pouch.component.html',
  styleUrl: './coin-pouch.component.scss',
})
export class HkCoinPouchComponent {
  // Inputs
  readonly coins = input.required<CoinPurse>();
  /** The whole purse expressed in gold, supplied by the caller; hidden when null. */
  readonly total = input<number | null>(null);
  readonly editable = input(true);

  // Outputs
  readonly edit = output<void>();
  readonly save = output<CoinPurse>();

  protected readonly editing = signal(false);
  protected readonly draft = signal<Record<CoinMetal, number | null>>({
    pp: 0,
    gp: 0,
    ep: 0,
    sp: 0,
    cp: 0,
  });

  /** The metals drawn: electrum only while the purse holds some. */
  protected readonly shown = computed(() =>
    METALS.filter((metal) => metal !== 'ep' || (this.coins().ep ?? 0) > 0),
  );
  /** The metals edited: electrum whenever the caller supplies it, even at zero (so it can be added). */
  protected readonly editedMetals = computed(() =>
    METALS.filter((metal) => metal !== 'ep' || this.coins().ep !== undefined),
  );

  protected readonly disc = DISC;
  protected readonly rows = DISC_ROWS;

  protected startEdit(): void {
    this.draft.set({ ep: 0, ...this.coins() });
    this.editing.set(true);
    this.edit.emit();
  }

  protected setDraft(metal: CoinMetal, value: number | null): void {
    this.draft.update((d) => ({ ...d, [metal]: value }));
  }

  protected commit(): void {
    const d = this.draft();
    // An emptied field is zero coins.
    this.save.emit({
      pp: d.pp ?? 0,
      gp: d.gp ?? 0,
      ...(this.coins().ep !== undefined ? { ep: d.ep ?? 0 } : {}),
      sp: d.sp ?? 0,
      cp: d.cp ?? 0,
    });
    this.editing.set(false);
  }

  protected cancel(): void {
    this.editing.set(false);
  }
}
