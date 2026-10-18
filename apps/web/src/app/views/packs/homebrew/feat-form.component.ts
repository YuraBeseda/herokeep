import { Component, linkedSignal } from '@angular/core';
import type { FeatEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  entityShell,
  FEAT_CATEGORIES,
  featureText,
  REQUIRED_KEY,
  type FieldErrors,
} from './entity-form.helpers';
import { HomebrewFormBase } from './homebrew-form.base';

type Category = FeatEntity['category'];

/**
 * Quick homebrew feat (ruling 10): name, category, repeatable, and the benefit text — which is
 * both the description and the one `feature.text` effect the sheet shows under the feat's name.
 * No prerequisites are authored (they would be mechanics); a requirement belongs in the text.
 */
@Component({
  selector: 'app-homebrew-feat-form',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './feat-form.component.html',
  styleUrl: './homebrew-form.scss',
})
export class FeatFormComponent extends HomebrewFormBase<FeatEntity> {
  protected readonly type = 'feat' as const;
  protected readonly categories = FEAT_CATEGORIES;

  protected readonly category = linkedSignal<Category>(() => this.entity()?.category ?? 'general');
  protected readonly repeatable = linkedSignal(() => this.entity()?.repeatable ?? false);

  protected setCategory(value: string): void {
    this.category.set(value as Category);
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
