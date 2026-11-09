import { Component, forwardRef, linkedSignal } from '@angular/core';
import type { SpeciesEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkNumberFieldComponent } from '../../../ui/number-field/number-field.component';
import { HkSelectComponent } from '../../../ui/select/select.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../ui/textarea/textarea.component';
import {
  entityShell,
  featureText,
  firstOf,
  REQUIRED_KEY,
  wholeNumber,
  type FieldErrors,
} from './entity-form.helpers';
import { HOMEBREW_FORM, HomebrewFormBase } from './homebrew-form.base';

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
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkButtonComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    HkSelectComponent,
    HkNumberFieldComponent,
    IconComponent,
  ],
  providers: [
    provideTranslocoScope('packs'),
    { provide: HOMEBREW_FORM, useExisting: forwardRef(() => SpeciesFormComponent) },
  ],
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

  protected snapshot(): string {
    return JSON.stringify([this.size(), this.speed(), this.creatureType(), this.traits()]);
  }

  protected sizeOptions() {
    return this.slugOptions('size', this.vocabulary().sizes);
  }
  protected creatureTypeOptions() {
    return this.slugOptions('creature-type', this.vocabulary().creatureTypes);
  }

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
