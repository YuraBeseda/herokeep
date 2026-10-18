import { computed, Directive, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { Entity } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
import {
  harvestVocabulary,
  REQUIRED_KEY,
  type FieldErrors,
  type HomebrewFormType,
  type HomebrewVocabulary,
} from './entity-form.helpers';

let nextFormId = 1;

/**
 * Common behaviour of the four quick-homebrew forms: the `entity` being edited (absent = new), the
 * shared name/description fields pre-filled from it, the core-harvested vocabulary, required-field
 * validation that only shows after the first Save attempt, and the submit/cancel outputs.
 *
 * A form never saves by itself: Save emits the built entity (`submitted`) — its id is the edited
 * entity's, or `HomebrewService.newEntityId(name, type)` for a new one — and the host
 * (`HomebrewEditorComponent`) runs the save, shows refusals and navigates. A field error blocks
 * the emit and is shown under its field (`role="alert"`, `aria-invalid`, `aria-describedby`).
 */
@Directive()
export abstract class HomebrewFormBase<E extends Entity> {
  private readonly engineFacade = inject(EngineFacade);
  private readonly homebrewService = inject(HomebrewService);

  // Inputs / outputs
  readonly entity = input<E | undefined>(undefined);
  readonly busy = input(false);
  readonly submitted = output<Entity>();
  readonly cancelled = output();

  protected abstract readonly type: HomebrewFormType;

  protected readonly uid = `hb-form-${nextFormId++}`;
  protected readonly vocabulary = computed<HomebrewVocabulary>(() =>
    harvestVocabulary(this.engineFacade.index(), this.engineFacade.localizer()),
  );
  protected readonly name = linkedSignal(() => this.entity()?.name ?? '');
  protected readonly description = linkedSignal(() => this.entity()?.description ?? '');
  /** Errors are shown only once Save was pressed (then live, as fields change). */
  protected readonly attempted = signal(false);
  protected readonly errors = computed<FieldErrors>(() => ({
    ...(this.name().trim() ? {} : { name: REQUIRED_KEY }),
    ...this.validate(),
  }));

  /** Field errors beyond the shared name field. */
  protected abstract validate(): FieldErrors;
  /** The entity the current field values describe, under `id`. */
  protected abstract build(id: string): E;

  /** The scope-relative message key to show under `field`, once Save was attempted. */
  protected shown(field: string): string | undefined {
    return this.attempted() ? this.errors()[field] : undefined;
  }

  protected errorId(field: string): string {
    return `${this.uid}-${field}-error`;
  }

  protected submit(): void {
    this.attempted.set(true);
    if (Object.keys(this.errors()).length > 0) return;
    const id = this.entity()?.id ?? this.homebrewService.newEntityId(this.name(), this.type);
    this.submitted.emit(this.build(id));
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}
