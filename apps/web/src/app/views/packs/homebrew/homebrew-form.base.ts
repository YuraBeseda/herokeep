import {
  computed,
  Directive,
  effect,
  inject,
  InjectionToken,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Entity } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
import type { SelectOption } from '../../../ui/select/select.component';
import {
  harvestVocabulary,
  REQUIRED_KEY,
  type FieldErrors,
  type HomebrewFormType,
  type HomebrewVocabulary,
} from './entity-form.helpers';

let nextFormId = 1;

/** Scope-relative translate function (`packs`) the templates hand to the option builders. */
export type PacksT = (key: string, params?: Record<string, unknown>) => string;

/** Scope-relative key of the "this name is taken" message. */
export const NAME_TAKEN_KEY = 'homebrew.field.name-taken';

/**
 * What the editor needs from whichever of the four forms is on screen: save it, ask whether it
 * holds unsaved edits, and read how many fields are refusing the save. The forms provide
 * themselves under this token, so the editor finds the active one with a single `viewChild`.
 */
export interface HomebrewFormHandle {
  readonly dirty: () => boolean;
  readonly invalidCount: () => number;
  requestSubmit(): void;
}
export const HOMEBREW_FORM = new InjectionToken<HomebrewFormHandle>('HOMEBREW_FORM');

/**
 * Common behaviour of the four quick-homebrew forms: the `entity` being edited (absent = new), the
 * shared name/description fields pre-filled from it, the core-harvested vocabulary, required-field
 * validation that only shows after the first Save attempt, a "name already used" check for a new
 * entry, dirty tracking, and the submit output.
 *
 * A form never saves by itself: Save (the strap's, through `requestSubmit`) emits the built entity
 * (`submitted`) — its id is the edited entity's, or `HomebrewService.newEntityId(name, type)` for a
 * new one — and the host (`HomebrewEditorComponent`) runs the save, shows refusals and navigates.
 * A field error blocks the emit and is shown under its field (`aria-invalid`, `aria-describedby`
 * come from the field components).
 *
 * `dirty` compares a snapshot of every field signal against the one taken when the entry was
 * loaded, so reverting an edit makes the form clean again.
 */
@Directive()
export abstract class HomebrewFormBase<E extends Entity> implements HomebrewFormHandle {
  private readonly engineFacade = inject(EngineFacade);
  private readonly homebrewService = inject(HomebrewService);

  // Inputs / outputs
  readonly entity = input<E | undefined>(undefined);
  readonly busy = input(false);
  readonly submitted = output<Entity>();

  protected abstract readonly type: HomebrewFormType;

  protected readonly uid = `hb-form-${nextFormId++}`;
  protected readonly vocabulary = computed<HomebrewVocabulary>(() =>
    harvestVocabulary(this.engineFacade.index(), this.engineFacade.localizer()),
  );
  protected readonly name = linkedSignal(() => this.entity()?.name ?? '');
  protected readonly description = linkedSignal(() => this.entity()?.description ?? '');
  /** Errors are shown only once Save was attempted (then live, as fields change). */
  protected readonly attempted = signal(false);
  protected readonly errors = computed<FieldErrors>(() => ({
    ...(this.name().trim() ? this.nameTakenError() : { name: REQUIRED_KEY }),
    ...this.validate(),
  }));

  /** The id a NEW entry would get from its current name, shown under the name field. */
  protected readonly newId = computed(() => {
    if (this.entity() || !this.name().trim()) return null;
    try {
      return this.homebrewService.newEntityId(this.name(), this.type);
    } catch {
      return null;
    }
  });

  /**
   * An entry whose name (trimmed, case-insensitive) is already used by another entry of the same
   * kind in this device's homebrew pack. The id is NOT the test: newEntityId makes every new id
   * unique (thing-2), so two entries with one name would both save and only the name would
   * tell them apart. When editing, the entry being edited is excluded.
   */
  private nameTakenError(): FieldErrors {
    const wanted = this.name().trim().toLowerCase();
    const own = this.entity()?.id;
    const taken = this.homebrewService
      .pack()
      ?.entities.some(
        (entity) =>
          entity.type === this.type &&
          entity.id !== own &&
          entity.name.trim().toLowerCase() === wanted,
      );
    return taken ? { name: NAME_TAKEN_KEY } : {};
  }

  /** A string capturing every field's value, for dirty tracking (subclasses add their fields). */
  protected abstract snapshot(): string;

  private readonly baseline = signal<string | null>(null);
  readonly dirty = computed(() => {
    const base = this.baseline();
    return base !== null && base !== this.fullSnapshot();
  });
  readonly invalidCount = computed(() =>
    this.attempted() ? Object.keys(this.errors()).length : 0,
  );

  private fullSnapshot(): string {
    return JSON.stringify([this.name(), this.description(), this.snapshot()]);
  }

  constructor() {
    // Re-baselines whenever the entity being edited changes (route reuse), before any edit.
    effect(() => {
      this.entity();
      untracked(() => this.baseline.set(this.fullSnapshot()));
    });
  }

  /** Field errors beyond the shared name field. */
  protected abstract validate(): FieldErrors;
  /** The entity the current field values describe, under `id`. */
  protected abstract build(id: string): E;

  /** The scope-relative message key to show under `field`, once Save was attempted. */
  protected shown(field: string): string | undefined {
    return this.attempted() ? this.errors()[field] : undefined;
  }

  /** The translated message under `field` (or `null`), for a field component's `error` input. */
  protected err(t: PacksT, field: string): string | null {
    const key = this.shown(field);
    return key ? t(key) : null;
  }

  // Option lists are memoised by content: a field component sees a new array only when a label or
  // value really changed, not on every change-detection pass.
  private readonly optionMemo = new Map<string, readonly SelectOption[]>();
  protected opts(id: string, next: readonly SelectOption[]): readonly SelectOption[] {
    const prior = this.optionMemo.get(id);
    if (
      prior?.length === next.length &&
      next.every((o, i) => o.value === prior[i]?.value && o.label === prior[i]?.label)
    ) {
      return prior;
    }
    this.optionMemo.set(id, next);
    return next;
  }

  /** A select's options for an enum: `homebrew.enum.<group>.<value>` labels. */
  protected enumOptions(
    t: PacksT,
    group: string,
    values: readonly string[],
  ): readonly SelectOption[] {
    return this.opts(
      group,
      values.map((value) => ({ value, label: t(`homebrew.enum.${group}.${value}`) })),
    );
  }

  /** A select's options for open pack vocabulary: the slugs, shown as the pack wrote them. */
  protected slugOptions(
    id: string,
    values: readonly string[],
    none?: string,
  ): readonly SelectOption[] {
    return this.opts(id, [
      ...(none !== undefined ? [{ value: '', label: none }] : []),
      ...values.map((value) => ({ value, label: value })),
    ]);
  }

  requestSubmit(): void {
    this.submit();
  }

  protected submit(): void {
    this.attempted.set(true);
    if (Object.keys(this.errors()).length > 0) return;
    const id = this.entity()?.id ?? this.homebrewService.newEntityId(this.name(), this.type);
    this.submitted.emit(this.build(id));
  }
}
