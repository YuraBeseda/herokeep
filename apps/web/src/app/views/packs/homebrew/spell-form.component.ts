import { Component, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SpellEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
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
import { HomebrewFormBase } from './homebrew-form.base';

type TimeUnit = SpellEntity['castingTime']['unit'];
type RangeKind = SpellEntity['range']['kind'];
type DurationKind = SpellEntity['duration']['kind'];
type DurationUnit = NonNullable<SpellEntity['duration']['unit']>;

/** Range kinds that carry a distance (the schema's `distance` is meaningless for the others). */
const DISTANCE_KINDS: readonly RangeKind[] = ['feet', 'miles'];

/**
 * Quick homebrew spell (ruling 10): the structural fields `SpellEntitySchema` requires — level,
 * school, casting time, range, components, duration, concentration/ritual and the classes whose
 * lists offer it — plus description and "at higher levels" text. Damage, saves and attacks stay in
 * the text.
 */
@Component({
  selector: 'app-homebrew-spell-form',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, NumberFieldComponent],
  providers: [provideTranslocoScope('packs')],
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

  protected needsDistance(): boolean {
    return DISTANCE_KINDS.includes(this.rangeKind());
  }

  protected setCastingUnit(value: string): void {
    this.castingUnit.set(value as TimeUnit);
  }

  protected setRangeKind(value: string): void {
    this.rangeKind.set(value as RangeKind);
  }

  protected setDurationKind(value: string): void {
    this.durationKind.set(value as DurationKind);
  }

  protected setDurationUnit(value: string): void {
    this.durationUnit.set(value as DurationUnit);
  }

  protected toggleClass(slug: string, checked: boolean): void {
    this.classes.update((list) =>
      checked ? [...list.filter((c) => c !== slug), slug] : list.filter((c) => c !== slug),
    );
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
