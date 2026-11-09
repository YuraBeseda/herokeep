import { Component, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HOMEBREW_FORM_TYPES } from './entity-form.helpers';

const TYPE_ICONS = {
  item: 'ui:bag',
  spell: 'ui:spells',
  feat: 'ui:features',
  species: 'ui:heroes',
} as const;

/**
 * "New homebrew entry": the dialog behind the strap's New button and the packs card — one button
 * per entry type. Closes with the chosen type (`item`/`spell`/`feat`/`species`), `undefined` on
 * Escape or Cancel.
 */
@Component({
  selector: 'app-homebrew-new-chooser',
  imports: [TranslocoDirective, HkButtonComponent, IconComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="hb-chooser__title" data-dialog-title>{{ t('homebrew.chooser.title') }}</h2>
      <div class="hb-chooser__list" role="group" [attr.aria-label]="t('homebrew.new-label')">
        @for (type of types; track type) {
          <button
            hk-button
            type="button"
            class="hb-chooser__type"
            [attr.data-type]="type"
            [variant]="'parchment'"
            (click)="choose(type)"
          >
            <hk-icon [icon]="icons[type]" />{{ t('homebrew.new.' + type) }}
          </button>
        }
      </div>
      <div class="hb-chooser__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'ghost-leather'" (click)="choose(undefined)">
          {{ t('homebrew.field.cancel') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 320px);
    }
    .hb-chooser__list {
      display: grid;
      gap: var(--space-2);
      margin-block-end: var(--space-3);
    }
  `,
})
export class HomebrewNewChooserComponent {
  private readonly dialogRef = inject(DialogRef);
  protected readonly types = HOMEBREW_FORM_TYPES;
  protected readonly icons = TYPE_ICONS;

  protected choose(type: string | undefined): void {
    this.dialogRef.close(type);
  }
}
