import { Component, computed, inject, input, output } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { DisplayPrefsService } from '../../shared/services/theme/display-prefs.service';
import { uniqueId } from '../format';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { HkTagChipComponent } from '../tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-feature-row` — one granted feature (design-system FeatureRow): its source glyph, the name,
 * a level badge (class and subclass rows) or a source chip (species, background, feats, chosen
 * options), and a details button that emits `details`.
 *
 * The source glyph and the level badge explain themselves through hint and accessible name
 * (`sourceHint` "From Paladin, level 3", `levelHint` "Gained at level 3"); the details button
 * reads "Details: <name>". Texts are already translated; grouping and ordering are the caller's.
 */
@Component({
  selector: 'hk-feature-row',
  imports: [IconComponent, HkIconButtonComponent, HkTagChipComponent, HkTooltipDirective],
  templateUrl: './feature-row.component.html',
  styleUrl: './feature-row.component.scss',
  host: {
    '[class.hk-feat--dimmed]': 'dimmed()',
    '[class.hk-feat--comfortable]': 'effectiveDensity() === "comfortable"',
  },
})
export class HkFeatureRowComponent {
  // Inputs
  readonly name = input.required<string>();
  /** The source glyph (`gi:<slug>` or `ui:<name>`). */
  readonly icon = input.required<string>();
  readonly sourceHint = input.required<string>();
  /** Level gained, for class and subclass rows. */
  readonly level = input<number | null>(null);
  readonly levelHint = input<string | null>(null);
  /** Translated source name for species / background / feat / chosen rows. */
  readonly source = input<string | null>(null);
  /** A row from an inactive multiclass level, dimmed to 60%. */
  readonly dimmed = input(false);
  /** `null` follows the saved Settings preference; a caller can pin a density (the phone sheet pins comfortable). */
  readonly density = input<'compact' | 'comfortable' | null>(null);
  private readonly prefs = inject(DisplayPrefsService);
  protected readonly effectiveDensity = computed(() => this.density() ?? this.prefs.density());

  // Outputs
  readonly details = output<void>();

  protected readonly nameId = uniqueId('hk-feat-name');
  protected readonly buttonId = uniqueId('hk-feat-details');
  protected readonly labelledBy = `${this.buttonId} ${this.nameId}`;
}
