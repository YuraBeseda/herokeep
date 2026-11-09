import { Component, forwardRef, linkedSignal } from '@angular/core';
import type { SpellEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { FilterChipOption } from '../../../ui/filter-chips/filter-chip.component';
import { HkFilterChipsComponent } from '../../../ui/filter-chips/filter-chips.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkNumberFieldComponent } from '../../../ui/number-field/number-field.component';
import { HkSelectComponent } from '../../../ui/select/select.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../ui/textarea/textarea.component';
import { HkToggleComponent } from '../../../ui/toggle/toggle.component';
import {
  DURATION_KINDS,
  DURATION_UNITS,
  entityShell,
  firstOf,
  RANGE_KINDS,
  REQUIRED_KEY,
  TIME_UNITS,
  wholeNumber,
  type FieldErrors,
} from './entity-form.helpers';
import { HOMEBREW_FORM, HomebrewFormBase, type PacksT } from './homebrew-form.base';

type TimeUnit = SpellEntity['castingTime']['unit'];
type RangeKind = SpellEntity['range']['kind'];
type DurationKind = SpellEntity['duration']['kind'];
type DurationUnit = NonNullable<SpellEntity['duration']['unit']>;

/** Range kinds that carry a distance (the schema's `distance` is meaningless for the others). */
const DISTANCE_KINDS: readonly RangeKind[] = ['feet', 'miles'];

/**
 * Quick homebrew spell (board PK05 vocabulary): the structural fields `SpellEntitySchema` requires
 * — level, school, casting time, range, components, duration, concentration/ritual and the classes
 * whose lists offer it — plus description and "at higher levels" text. Damage, saves and attacks
 * stay in the text.
 */
@Component({
  selector: 'app-homebrew-spell-form',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    HkSelectComponent,
    HkNumberFieldComponent,
    HkToggleComponent,
    HkFilterChipsComponent,
  ],
  providers: [
    provideTranslocoScope('packs'),
    { provide: HOMEBREW_FORM, useExisting: forwardRef(() => SpellFormComponent) },
  ],
  templateUrl: './spell-form.component.html',
  styleUrl: './homebrew-form.scss',
})
export class SpellFormComponent extends HomebrewFormBase<SpellEntity> {
  protected readonly type = 'spell' as const;
  protected readonly timeUnits = TIME_UNITS;
  protected readonly rangeKinds = RANGE_KINDS;
  protected readonly durationKinds = DURATION_KINDS;
  protected readonly durationUnits = DURATION_UNITS;

  protected readonly level = linkedSignal<number | null>(() => this.entity()?.level ?? 0);
  protected readonly school = linkedSignal(
    () => this.entity()?.school ?? firstOf(this.vocabulary().schools),
  );
  protected readonly castingValue = linkedSignal<number | null>(
    () => this.entity()?.castingTime.value ?? 1,
  );
  protected readonly castingUnit = linkedSignal<TimeUnit>(
    () => this.entity()?.castingTime.unit ?? 'action',
  );
  protected readonly rangeKind = linkedSignal<RangeKind>(() => this.entity()?.range.kind ?? 'self');
  protected readonly rangeDistance = linkedSignal<number | null>(
    () => this.entity()?.range.distance ?? null,
  );
  protected readonly verbal = linkedSignal(() => this.entity()?.components.v ?? false);
  protected readonly somatic = linkedSignal(() => this.entity()?.components.s ?? false);
  protected readonly material = linkedSignal(() => this.entity()?.components.m ?? false);
  protected readonly materialText = linkedSignal(
    () => this.entity()?.components.materialText ?? '',
  );
  protected readonly durationKind = linkedSignal<DurationKind>(
    () => this.entity()?.duration.kind ?? 'instantaneous',
  );
  protected readonly durationValue = linkedSignal<number | null>(
    () => this.entity()?.duration.value ?? null,
  );
  protected readonly durationUnit = linkedSignal<DurationUnit>(
    () => this.entity()?.duration.unit ?? 'minute',
  );
  protected readonly concentration = linkedSignal(() => this.entity()?.concentration ?? false);
  protected readonly ritual = linkedSignal(() => this.entity()?.ritual ?? false);
  protected readonly classes = linkedSignal<readonly string[]>(() => this.entity()?.classes ?? []);
  protected readonly higherLevels = linkedSignal(() => this.entity()?.higherLevels ?? '');

  protected snapshot(): string {
    return JSON.stringify([
      this.level(),
      this.school(),
      this.castingValue(),
      this.castingUnit(),
      this.rangeKind(),
      this.rangeDistance(),
      this.verbal(),
      this.somatic(),
      this.material(),
      this.materialText(),
      this.durationKind(),
      this.durationValue(),
      this.durationUnit(),
      this.concentration(),
      this.ritual(),
      this.classes(),
      this.higherLevels(),
    ]);
  }

  protected needsDistance(): boolean {
    return DISTANCE_KINDS.includes(this.rangeKind());
  }

  protected schoolOptions() {
    return this.slugOptions('school', this.vocabulary().schools);
  }
  protected timeUnitOptions(t: PacksT) {
    return this.enumOptions(t, 'time-unit', this.timeUnits);
  }
  protected rangeKindOptions(t: PacksT) {
    return this.enumOptions(t, 'range-kind', this.rangeKinds);
  }
  protected durationKindOptions(t: PacksT) {
    return this.enumOptions(t, 'duration-kind', this.durationKinds);
  }
  protected durationUnitOptions(t: PacksT) {
    return this.enumOptions(t, 'duration-unit', this.durationUnits);
  }

  private classOptionsMemo: readonly FilterChipOption[] = [];
  /** The class chips: the localized class names, keyed by slug. */
  protected classOptions(): readonly FilterChipOption[] {
    const next = this.vocabulary().classes.map((c) => ({ id: c.slug, label: c.name }));
    const same =
      next.length === this.classOptionsMemo.length &&
      next.every(
        (o, i) =>
          o.id === this.classOptionsMemo[i]?.id && o.label === this.classOptionsMemo[i]?.label,
      );
    return same ? this.classOptionsMemo : (this.classOptionsMemo = next);
  }

  protected setCastingUnit(value: string | null): void {
    if (value) this.castingUnit.set(value as TimeUnit);
  }
  protected setRangeKind(value: string | null): void {
    if (value) this.rangeKind.set(value as RangeKind);
  }
  protected setDurationKind(value: string | null): void {
    if (value) this.durationKind.set(value as DurationKind);
  }
  protected setDurationUnit(value: string | null): void {
    if (value) this.durationUnit.set(value as DurationUnit);
  }

  protected validate(): FieldErrors {
    const errors: Record<string, string> = {};
    const level = wholeNumber(this.level());
    if (level === null || level < 0 || level > 9)
      errors['level'] = 'homebrew.field.spell.level-invalid';
    if (!this.school()) errors['school'] = REQUIRED_KEY;
    const casting = wholeNumber(this.castingValue());
    if (casting === null || casting < 1) errors['castingValue'] = 'homebrew.field.positive-number';
    if (this.needsDistance()) {
      const distance = wholeNumber(this.rangeDistance());
      if (distance === null || distance < 1)
        errors['rangeDistance'] = 'homebrew.field.positive-number';
    }
    if (this.durationKind() === 'time') {
      const value = wholeNumber(this.durationValue());
      if (value === null || value < 1) errors['durationValue'] = 'homebrew.field.positive-number';
    }
    if (this.classes().length === 0) errors['classes'] = 'homebrew.field.spell.classes-required';
    return errors;
  }

  protected build(id: string): SpellEntity {
    const materialText = this.materialText().trim();
    const higherLevels = this.higherLevels().trim();
    const durationKind = this.durationKind();
    return {
      ...entityShell(id, this.name(), this.description()),
      type: 'spell',
      level: this.level() ?? 0,
      school: this.school(),
      castingTime: { value: this.castingValue() ?? 1, unit: this.castingUnit() },
      range: {
        kind: this.rangeKind(),
        ...(this.needsDistance() ? { distance: this.rangeDistance() ?? 1 } : {}),
      },
      components: {
        v: this.verbal(),
        s: this.somatic(),
        m: this.material(),
        ...(this.material() && materialText ? { materialText } : {}),
      },
      duration: {
        kind: durationKind,
        ...(durationKind === 'time'
          ? { value: this.durationValue() ?? 1, unit: this.durationUnit() }
          : {}),
      },
      concentration: this.concentration(),
      ritual: this.ritual(),
      classes: [...this.classes()].sort(),
      ...(higherLevels ? { higherLevels } : {}),
    };
  }
}
