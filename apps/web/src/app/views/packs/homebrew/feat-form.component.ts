import { Component, forwardRef, linkedSignal } from '@angular/core';
import type { FeatEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkSelectComponent } from '../../../ui/select/select.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../ui/textarea/textarea.component';
import { HkToggleComponent } from '../../../ui/toggle/toggle.component';
import {
  entityShell,
  FEAT_CATEGORIES,
  featureText,
  REQUIRED_KEY,
  type FieldErrors,
} from './entity-form.helpers';
import { HOMEBREW_FORM, HomebrewFormBase, type PacksT } from './homebrew-form.base';

type Category = FeatEntity['category'];

/**
 * Quick homebrew feat (ruling 10): name, category, repeatable, and the benefit text — which is
 * both the description and the one `feature.text` effect the sheet shows under the feat's name.
 * No prerequisites are authored (they would be mechanics); a requirement belongs in the text.
 */
@Component({
  selector: 'app-homebrew-feat-form',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    HkSelectComponent,
    HkToggleComponent,
  ],
  providers: [
    provideTranslocoScope('packs'),
    { provide: HOMEBREW_FORM, useExisting: forwardRef(() => FeatFormComponent) },
  ],
  templateUrl: './feat-form.component.html',
  styleUrl: './homebrew-form.scss',
})
export class FeatFormComponent extends HomebrewFormBase<FeatEntity> {
  protected readonly type = 'feat' as const;
  protected readonly categories = FEAT_CATEGORIES;

  protected readonly category = linkedSignal<Category>(() => this.entity()?.category ?? 'general');
  protected readonly repeatable = linkedSignal(() => this.entity()?.repeatable ?? false);

  protected snapshot(): string {
    return JSON.stringify([this.category(), this.repeatable()]);
  }

  protected categoryOptions(t: PacksT) {
    return this.enumOptions(t, 'feat-category', this.categories);
  }

  protected setCategory(value: string | null): void {
    if (value) this.category.set(value as Category);
  }

  protected validate(): FieldErrors {
    return this.description().trim() ? {} : { description: REQUIRED_KEY };
  }

  protected build(id: string): FeatEntity {
    const shell = entityShell(id, this.name(), this.description());
    return {
      ...shell,
      type: 'feat',
      effects: [featureText(this.name(), this.description())],
      category: this.category(),
      repeatable: this.repeatable(),
    };
  }
}
