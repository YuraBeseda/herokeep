import { Component, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { HkButtonComponent } from '../../../ui/button/button.component';

/** The Markdown forms a description accepts: the syntax sample for each described form. */
const SYNTAX = {
  bold: '**bold**',
  italic: '_italic_',
  list: '- item',
  heading: '## heading',
} as const;

/** The strap's "Markdown help": a short cheat-sheet of what a description supports. */
@Component({
  selector: 'app-markdown-help',
  imports: [TranslocoDirective, HkButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="md-help__title" data-dialog-title>{{ t('homebrew.markdown.title') }}</h2>
      <p class="md-help__intro">{{ t('homebrew.markdown.intro') }}</p>
      <dl class="md-help__list">
        @for (sample of samples; track sample) {
          <dt>
            <code>{{ syntax[sample] }}</code>
          </dt>
          <dd>{{ t('homebrew.markdown.' + sample) }}</dd>
        }
      </dl>
      <div class="md-help__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'primary'" (click)="close()">
          {{ t('homebrew.markdown.close') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .md-help__list {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      margin: 0 0 var(--space-3);
    }

    .md-help__list dd {
      margin: 0;
    }
  `,
})
export class MarkdownHelpComponent {
  private readonly dialogRef = inject(DialogRef);
  protected readonly samples = Object.keys(SYNTAX) as (keyof typeof SYNTAX)[];
  protected readonly syntax = SYNTAX;

  protected close(): void {
    this.dialogRef.close();
  }
}
