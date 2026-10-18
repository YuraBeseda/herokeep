import { computed, inject, Injectable } from '@angular/core';
import { EngineScope } from '../services/engine/engine.facade';
import { CharacterStore } from './character.store';

/**
 * Plan 15 Task 4: scopes a component-level `EngineFacade` to the loaded character's own pins
 * (`provideEngineScope(CharacterEngineScope)`), so everything rendered under the sheet shell —
 * the tabs, level-up, popovers — resolves names, pickers and validation against the same
 * per-character index `CharacterStore.sheet` derives with.
 */
@Injectable()
export class CharacterEngineScope extends EngineScope {
  private readonly characterStore = inject(CharacterStore);

  readonly pins = computed(() => this.characterStore.facts()?.pins);
}
