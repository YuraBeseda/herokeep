import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { HkPoolBarComponent } from '../../../../../ui/pool-bar/pool-bar.component';
import { PlayActionsService } from '../play-actions.service';
import { breakdownOpener } from '../open-breakdown';
import { sheetNames } from '../play-names';

// The reset tags a resource carries (`resource.define.reset`), each with the glyph of its hint.
const RESET_GLYPH: Record<string, string> = {
  shortRest: 'ui:short-rest',
  longRest: 'ui:long-rest',
  dawn: 'ui:recharge-dawn',
};

/**
 * Resources (spec §4.2): one `hk-pool-bar` per class/feature resource — a gauge or a row of wax
 * seals with the remaining count, the reset hint, a Use button and a one-use Restore. Names are the
 * granting feature's localized name (the baked English `view.name` is only a fallback).
 */
@Component({
  selector: 'app-resources-leaf',
  imports: [TranslocoDirective, HkLeafComponent, HkPoolBarComponent, HkButtonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './resources-leaf.component.html',
  styleUrl: './resources-leaf.component.scss',
})
export class ResourcesLeafComponent {
  readonly phone = input(false);

  protected readonly actions = inject(PlayActionsService);
  private readonly names = sheetNames(inject(EngineFacade));
  private readonly sheet = inject(CharacterStore).sheet;

  protected readonly openBreakdown = breakdownOpener();

  protected readonly resources = computed(() =>
    (this.sheet()?.resources ?? []).map((view) => ({
      view,
      label: this.names.resourceLabel(view),
      remaining: Math.max(0, view.max.value - view.used),
      kind: view.display === 'number' ? ('points' as const) : ('pips' as const),
      resetGlyph: RESET_GLYPH[view.reset] ?? null,
    })),
  );
}
