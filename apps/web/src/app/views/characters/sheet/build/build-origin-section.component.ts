import { Component, computed, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { sheetNames } from '../play/play-names';
import { BuildLockComponent } from './build-lock.component';
import { originRows, type BuildSource, type OriginRow } from './build-view';

/**
 * Board B01, "Origin and class": species, class with its level, subclass (or the level it is
 * chosen at), background and the origin feat the background grants. Every row says why it cannot
 * be edited here with a lock chip whose reason is a hint.
 */
@Component({
  selector: 'app-build-origin-section',
  imports: [TranslocoDirective, HkLeafComponent, IconComponent, BuildLockComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-origin-section.component.html',
  styleUrl: './build-section.scss',
})
export class BuildOriginSectionComponent {
  private readonly store = inject(CharacterStore);
  private readonly facade = inject(EngineFacade);
  private readonly names = sheetNames(this.facade);

  protected readonly rows = computed<OriginRow[]>(() => {
    const facts = this.store.facts();
    const sheet = this.store.sheet();
    if (!facts || !sheet) return [];
    const src: BuildSource = {
      facts,
      sheet,
      index: this.facade.index(),
      localizer: this.facade.localizer(),
      names: this.names,
    };
    return originRows(src);
  });
}
