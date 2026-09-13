import { Component, Directive, inject, input } from '@angular/core';
import type { Sheet } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '../components/button/button.component';
import { DIALOG_DATA, DialogRef, DialogService } from '../components/dialog/dialog.service';
import { EngineFacade } from '../services/engine/engine.facade';

// `@hk/engine`'s barrel only re-exports `Sheet` itself (see `derive/index.ts`) — `Derived`/
// `Contribution` (declared in `derive/modifiers.ts`) never leave that module directly. Recovered
// the same way `create-wizard.component.ts` recovers `Sheet['inventory'][number]`: an
// indexed-access alias off a Sheet field that's already typed `Derived<number>`.
export type DerivedValue = Sheet['ac'];
export type DerivedContribution = DerivedValue['contributions'][number];

/**
 * One-off dialog content for `hkDerived`'s provenance popover (doc-09: "Components render
 * `Derived<number>` values with a provenance popover"). Lives in the same file as the directive
 * that opens it — mirrors `CharactersDeleteConfirmComponent`'s "tiny wrapper component" convention
 * (`hk-dialog`'s SKILL.md: no templates-as-content API) — neither has any reason to exist without
 * the other. Rendered through the global (unscoped) `*transloco` lookup would also work (same
 * reasoning as `hk-toast`'s SKILL.md), but this attaches its own scope directly since it can be
 * opened from anywhere `hkDerived` is used, not only from a component that already provides one.
 */
@Component({
  selector: 'app-derived-popover',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('characters')],
  template: `
    <ng-container *transloco="let t; read: 'characters.sheet.derivedPopover'">
      <h2 class="derived-popover__title">{{ t('title') }}</h2>
      @if (contributions.length > 0) {
        <ul class="derived-popover__list">
          @for (
            c of contributions;
            track c.source + '|' + (c.feature ?? '') + '|' + c.kind + '|' + (c.key ?? '')
          ) {
            <li class="derived-popover__row">
              <span class="derived-popover__source">{{ sourceName(c) }}</span>
              <span class="derived-popover__amount">{{ amountText(c) }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="derived-popover__empty">{{ t('empty') }}</p>
      }
      <button
        hk-button
        type="button"
        [variant]="'ghost'"
        class="derived-popover__close"
        (click)="dialogRef.close()"
      >
        {{ t('close') }}
      </button>
    </ng-container>
  `,
})
export class DerivedPopoverContentComponent {
  private readonly data = inject<DerivedValue>(DIALOG_DATA);
  private readonly engineFacade = inject(EngineFacade);
  protected readonly dialogRef = inject(DialogRef);

  protected readonly contributions: DerivedContribution[] = this.data.contributions;

  // Prefers `feature` (the specific granting sub-entity, e.g. a chosen fighting-style feat) over
  // `source` (the root that granted it, e.g. the class) when both are present — `composition.ts`'s
  // `ActiveEffect` doc: `feature` is set only when the effect was reached through a grant hop off
  // `source`, i.e. it's the more specific, more useful-to-show id. Falls back to the raw id for the
  // rare contribution whose id doesn't resolve in the index (e.g. a synthetic 'override' source).
  protected sourceName(c: DerivedContribution): string {
    const id = c.feature ?? c.source;
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
  }

  protected amountText(c: DerivedContribution): string {
    if (c.formula !== undefined) return c.formula;
    if (c.amount === undefined) return '';
    return c.amount > 0 ? `+${c.amount}` : `${c.amount}`;
  }
}

/**
 * `hkDerived` (task-10-brief.md) — an attribute directive meant to be attached straight onto
 * `hk-stat-tile`'s host tag (its own SKILL.md's documented usage): `hk-stat-tile` deliberately has
 * no `role`/`tabindex`/interactivity of its own, so this directive supplies all three, plus the
 * click/keyboard handling that opens `DerivedPopoverContentComponent` in an `hk-dialog` listing
 * every contribution behind the bound `Derived<number>`.
 */
@Directive({
  selector: '[hkDerived]',
  host: {
    role: 'button',
    tabindex: '0',
    '(click)': 'open()',
    '(keydown.enter)': 'open()',
    '(keydown.space)': 'onSpace($event)',
  },
})
export class DerivedPopoverDirective {
  private readonly dialogService = inject(DialogService);

  readonly hkDerivedBreakdown = input.required<DerivedValue>();

  protected open(): void {
    this.dialogService.open(DerivedPopoverContentComponent, { data: this.hkDerivedBreakdown() });
  }

  // Space's default behavior (page scroll) would otherwise fire on a `role="button"` host that
  // isn't a real `<button>` — this directive never gets to piggyback on native button semantics.
  protected onSpace(event: Event): void {
    event.preventDefault();
    this.open();
  }
}
