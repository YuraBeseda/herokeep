import { Component, computed, inject, resource, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DIALOG_DATA, DialogRef } from '../../../../ui/dialog/dialog.service';
import { HkNumberFieldComponent } from '../../../../ui/number-field/number-field.component';
import { HkSearchFieldComponent } from '../../../../ui/search-field/search-field.component';

/** One selectable condition entity, pre-resolved by the CALLER (`PlayTabComponent`) — never by
 * this component (same "resolve before opening" convention `CastDialogData.availableSlots`
 * documents). `name` is already localizer-resolved text; `levelBearing` is data-driven off the
 * entity itself (`ConditionEntitySchema.levels !== undefined`, `@hk/protocol`) — NEVER a
 * hardcoded exhaustion id. */
export interface ConditionDialogOption {
  readonly id: string;
  readonly name: string;
  readonly levelBearing: boolean;
  /** The pack's own level count for a level-bearing condition (`ConditionEntitySchema.levels`,
   * exhaustion: 6): the level stepper's maximum. Absent when the pack gives none (no cap). */
  readonly maxLevel?: number;
  /** The condition's localized effect text (markdown), read off the entity by the caller. */
  readonly description?: string;
}

export interface ConditionDialogData {
  readonly options: readonly ConditionDialogOption[];
}

export interface ConditionDialogResult {
  readonly conditionId: string;
  readonly level?: number;
  /** A `rounds` duration (plan 18 task 2); absent = no duration. */
  readonly rounds?: number;
}

/**
 * The condition-add dialog (board DL03) — `PlayActionsService.addCondition` opens this via
 * `DialogService.open()`. Same "own injector, no inherited `provideTranslocoScope('characters')`,
 * full unscoped keys through its own `*transloco`" pattern as `CastDialogComponent`, safe for the
 * identical reason: the only caller has already loaded the `characters` scope.
 *
 * The picker is a searchable group of radio chips. A search only narrows what is shown: when it
 * hides the chosen condition the choice moves to the first one still shown, so what Add adds is
 * always on screen.
 *
 * Level stepper: shown only for a `levelBearing` option, from 1 to the pack's own level count
 * (`maxLevel`, read off the condition entity by the caller — exhaustion: 6). It resets to 1 when
 * another condition is chosen, since the reducer replaces-by-`conditionId`. Duration fields (a
 * round/minute count, "until a rest") arrive with plan slice 2 and are NOT part of this dialog yet.
 *
 * Closes with a `ConditionDialogResult` on confirm, or `undefined` on cancel/ESC/backdrop.
 */
@Component({
  selector: 'app-condition-dialog',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkNumberFieldComponent,
    HkSearchFieldComponent,
    IconComponent,
  ],
  // The dialog renders under the root injector, outside the sheet's scope: it scopes its own
  // `EngineFacade` to the character's pins so the effect text's cross-links name entities the way
  // the sheet does (the same arrangement the add-item dialog uses).
  providers: [CharacterEngineScope, provideEngineScope(CharacterEngineScope)],
  templateUrl: './condition-dialog.component.html',
  styleUrl: './condition-dialog.component.scss',
})
export class ConditionDialogComponent {
  protected readonly data = inject<ConditionDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly engineFacade = inject(EngineFacade);
  private readonly markdownService = inject(MarkdownService);

  protected readonly query = signal('');
  private readonly pickedId = signal<string | undefined>(this.data.options[0]?.id);
  protected readonly level = signal<number | null>(1);
  protected readonly rounds = signal<number | null>(null);

  protected readonly visibleOptions = computed(() => {
    const needle = this.query().trim().toLocaleLowerCase();
    return needle === ''
      ? this.data.options
      : this.data.options.filter((o) => o.name.toLocaleLowerCase().includes(needle));
  });

  /** The chosen condition: the picked one while it is shown, else the first one that is. */
  protected readonly selectedId = computed(() => {
    const visible = this.visibleOptions();
    const picked = this.pickedId();
    return visible.some((o) => o.id === picked) ? picked : visible[0]?.id;
  });

  protected readonly selectedOption = computed(() =>
    this.data.options.find((o) => o.id === this.selectedId()),
  );

  protected readonly showsLevel = computed(() => this.selectedOption()?.levelBearing ?? false);
  protected readonly maxLevel = computed(() => this.selectedOption()?.maxLevel);

  /** The chosen condition's effect text, rendered through the same sanitizing markdown service the
   * description drawer and the library detail page use. */
  protected readonly effectHtml = resource({
    params: () => this.selectedOption()?.description,
    loader: async ({ params }) =>
      params ? this.markdownService.render(params, this.engineFacade.localizer()) : null,
  });

  protected select(id: string): void {
    if (id !== this.selectedId()) this.level.set(1);
    this.pickedId.set(id);
  }

  /** Radio-group keys: the arrows move the choice through the chips shown (wrapping). */
  protected onChipKey(event: KeyboardEvent, index: number): void {
    const visible = this.visibleOptions();
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || visible.length === 0) return;
    event.preventDefault();
    const next = (index + step + visible.length) % visible.length;
    this.select(visible[next].id);
    const chips = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
      '[role="radio"]',
    );
    chips?.[next]?.focus();
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const conditionId = this.selectedId();
    if (!conditionId) return;
    if (this.showsLevel() && (this.level() === null || this.level()! < 1)) return;
    const cap = this.maxLevel();
    const wanted = this.level() ?? 1;
    const level = this.showsLevel()
      ? cap === undefined
        ? wanted
        : Math.min(wanted, cap)
      : undefined;
    const rounds = this.rounds();
    this.dialogRef.close({
      conditionId,
      level,
      ...(rounds !== null && rounds >= 1 ? { rounds: Math.min(999, Math.trunc(rounds)) } : {}),
    } satisfies ConditionDialogResult);
  }
}
