import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { DerivedPopoverDirective } from '@shared/directives/derived-popover.directive';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkHpGaugeComponent } from '../../../../../ui/hp-gauge/hp-gauge.component';
import { HkShieldBadgeComponent } from '../../../../../ui/shield-badge/shield-badge.component';
import { HkStatTileComponent } from '../../../../../ui/stat-tile/stat-tile.component';
import { signed } from '../../../../../ui/format';
import { PlayActionsService } from '../play-actions.service';
import { sheetNames } from '../play-names';

/**
 * The vitals leaf: the HP strap (`hk-hp-gauge`: Damage / Heal / Temp on one typed amount), the AC
 * shield, initiative and speed, and — on the desktop folio — the proficiency bonus, passive
 * perception, hit dice and the maximum-HP provenance. The same component sits in the shell's folio
 * on tablet/desktop and at the top of the phone's Combat tab (spec §4.2); it holds no layout of
 * its own beyond its own grid.
 */
@Component({
  selector: 'app-vitals-leaf',
  imports: [
    TranslocoDirective,
    HkHpGaugeComponent,
    HkShieldBadgeComponent,
    HkStatTileComponent,
    DerivedPopoverDirective,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './vitals-leaf.component.html',
  styleUrl: './vitals-leaf.component.scss',
  host: { '[class.vitals--compact]': 'compact()' },
})
export class VitalsLeafComponent {
  /** The phone's Combat tab shows HP, AC, initiative and speed only. */
  readonly compact = input(false);

  protected readonly actions = inject(PlayActionsService);
  private readonly names = sheetNames(inject(EngineFacade));
  protected readonly sheet = inject(CharacterStore).sheet;
  protected readonly signed = signed;

  protected readonly speedRows = computed(() =>
    Object.entries(this.sheet()?.speed ?? {}).map(([mode, value]) => ({ mode, value })),
  );

  protected readonly hitDiceRows = computed(() =>
    Object.entries(this.sheet()?.hp.hitDice ?? {}).map(([classId, dice]) => ({
      classId,
      className: this.names.resolve(classId),
      ...dice,
    })),
  );

  protected readonly hitDiceText = computed(() =>
    this.hitDiceRows()
      .map((row) => `${row.remaining}/${row.total} d${row.die}`)
      .join(' · '),
  );
}
