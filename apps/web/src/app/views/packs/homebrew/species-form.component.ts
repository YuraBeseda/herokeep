import { Component, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SpeciesEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import {
  entityShell,
  featureText,
  firstOf,
  REQUIRED_KEY,
  wholeNumber,
  type FieldErrors,
} from './entity-form.helpers';
import { HomebrewFormBase } from './homebrew-form.base';

/** One trait row of the form: becomes a `feature.text` effect (text-only mechanics). */
export interface TraitRow {
  readonly name: string;
  readonly text: string;
}

/**
 * Quick homebrew species (ruling 10): the structural fields `SpeciesEntitySchema` requires — size,
 * walking speed, creature type — plus traits, each a named `feature.text` the sheet shows.
 */
@Component({
  selector: 'app-homebrew-species-form',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, NumberFieldComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './species-form.component.html',
  styleUrl: './homebrew-form.scss',
})
export class SpeciesFormComponent extends HomebrewFormBase<SpeciesEntity> {
  protected readonly type = 'species' as const;

  protected readonly size = linkedSignal(
    () => this.entity()?.size ?? firstOf(this.vocabulary().sizes),
  );
  protected readonly speed = linkedSignal<number | null>(() => this.entity()?.speed ?? null);
  protected readonly creatureType = linkedSignal(
    () => this.entity()?.creatureType ?? firstOf(this.vocabulary().creatureTypes),
  );
  protected readonly traits = linkedSignal<readonly TraitRow[]>(() =>
    (this.entity()?.effects ?? []).flatMap((effect) =>
      effect.type === 'feature.text' ? [{ name: effect.name, text: effect.description }] : [],
    ),
  );

  protected addTrait(): void {
    this.traits.update((rows) => [...rows, { name: '', text: '' }]);
  }

  protected removeTrait(index: number): void {
    this.traits.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected setTrait(index: number, patch: Partial<TraitRow>): void {
    this.traits.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  protected validate(): FieldErrors {
    const errors: Record<string, string> = {};
    if (!this.size()) errors['size'] = REQUIRED_KEY;
    if (!this.creatureType()) errors['creatureType'] = REQUIRED_KEY;
    const speed = wholeNumber(this.speed());
    if (this.speed() === null) errors['speed'] = REQUIRED_KEY;
    else if (speed === null || speed < 0) errors['speed'] = 'homebrew.field.item.whole-number';
    this.traits().forEach((row, i) => {
      if (!row.name.trim() || !row.text.trim())
        errors[`trait-${i}`] = 'homebrew.field.species.trait-incomplete';
    });
    return errors;
  }

  protected build(id: string): SpeciesEntity {
    return {
      ...entityShell(id, this.name(), this.description()),
      type: 'species',
      effects: this.traits().map((row) => featureText(row.name, row.text)),
      size: this.size(),
      speed: this.speed() ?? 0,
      creatureType: this.creatureType(),
    };
  }
}
