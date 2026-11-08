import { Component, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';

export interface CoinPurse {
  readonly pp: number;
  readonly gp: number;
  readonly sp: number;
  readonly cp: number;
}

const METALS = ['pp', 'gp', 'sp', 'cp'] as const;
export type CoinMetal = (typeof METALS)[number];

/** The disc colours of a metal: CSS custom properties of the design tokens. */
const DISC: Record<CoinMetal, { top: string; shade: string }> = {
  pp: { top: 'var(--coin-platinum)', shade: 'var(--coin-platinum-shade)' },
  gp: { top: 'var(--coin-gold)', shade: 'var(--coin-gold-shade)' },
  sp: { top: 'var(--coin-silver)', shade: 'var(--coin-silver-shade)' },
  cp: { top: 'var(--coin-copper)', shade: 'var(--coin-copper-shade)' },
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
 * disc colour alone. A zero stack still shows. The edit button emits `edit`; the editing
 * controls themselves (a number field per metal) are the caller's to show.
 */
@Component({
  selector: 'hk-coin-pouch',
  imports: [TranslocoDirective, HkIconButtonComponent],
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

  protected readonly metals = METALS;
  protected readonly disc = DISC;
  protected readonly rows = DISC_ROWS;
}
