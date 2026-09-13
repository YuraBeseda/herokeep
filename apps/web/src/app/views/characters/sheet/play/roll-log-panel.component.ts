import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DiceResultComponent } from '@shared/components/dice-result/dice-result.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';

/** The advantage/disadvantage toggle's three states (task-7-brief.md) — `'normal'` rolls a plain
 * `1d20`; `'adv'`/`'dis'` roll `2d20kh1`/`2d20kl1` for the NEXT d20 roll only, then this component
 * (via its two-way `advantageMode` model) resets back to `'normal'` — see
 * `PlayTabComponent.performD20Roll`, the one place that actually consumes the mode to build a
 * roll spec. Exported so `PlayTabComponent` can type its own bound signal against it. */
export type AdvantageMode = 'normal' | 'adv' | 'dis';

interface ManualLabelOption {
  readonly id: string;
  readonly labelKey: string;
}

// The manual-entry row's fixed label choices (task-7-brief.md: "a manual-entry row (number-field
// + label select)") — a small, closed set of roll KINDS (never a free-text label, which would be
// a user-visible string literal outside the Localizer — CLAUDE.md rule 2), each a scope-relative
// Transloco key resolved through this component's own `read: 'characters'` `*transloco`.
const MANUAL_LABEL_OPTIONS: readonly ManualLabelOption[] = [
  { id: 'check', labelKey: 'sheet.roll.manual.labels.check' },
  { id: 'save', labelKey: 'sheet.roll.manual.labels.save' },
  { id: 'attack', labelKey: 'sheet.roll.manual.labels.attack' },
  { id: 'damage', labelKey: 'sheet.roll.manual.labels.damage' },
  { id: 'other', labelKey: 'sheet.roll.manual.labels.other' },
];

/**
 * `app-roll-log-panel` (task-7-brief.md) — the play tab's dice-log section: the advantage/
 * disadvantage toggle group, a manual-entry row, and the log itself (newest first, rendered via
 * `hk-dice-result`). Wrapped in its own `hk-sheet-section [collapsible]="true"` — reuses that
 * component's collapse/expand behavior rather than re-implementing it (task-7-brief.md: "log
 * panel: collapsible (hk-sheet-section conventions)").
 *
 * `advantageMode` is a two-way `model()` (same idiom `hk-tabs`' own `selected` demonstrates) —
 * `PlayTabComponent` binds it (`[(advantageMode)]`) so its own d20-roll handlers can read the
 * CURRENT mode and reset it back to `'normal'` after consuming it, while this panel owns the
 * toggle UI. Every actual roll (ability/save/skill/attack/spell) is triggered from
 * `PlayTabComponent`'s own rows, not from here — this component only ever calls
 * `RollLogService.addManual` itself, for the manual-entry row.
 */
@Component({
  selector: 'app-roll-log-panel',
  imports: [
    TranslocoDirective,
    FormsModule,
    ButtonComponent,
    NumberFieldComponent,
    SheetSectionComponent,
    DiceResultComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './roll-log-panel.component.html',
  styleUrl: './roll-log-panel.component.scss',
})
export class RollLogPanelComponent {
  private readonly rollLogService = inject(RollLogService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  readonly advantageMode = model<AdvantageMode>('normal');

  protected readonly entries = this.rollLogService.entries;
  protected readonly manualLabelOptions = MANUAL_LABEL_OPTIONS;

  protected readonly manualAmount = signal<number | null>(null);
  protected readonly manualLabelId = signal<string>('check');

  protected setAdvantageMode(mode: AdvantageMode): void {
    this.advantageMode.set(mode);
  }

  protected onManualAmountChange(value: number | null): void {
    this.manualAmount.set(value);
  }

  protected onManualLabelChange(id: string): void {
    this.manualLabelId.set(id);
  }

  protected onAddManual(t: (key: string, params?: Record<string, unknown>) => string): void {
    const amount = this.manualAmount();
    if (amount === null) return;
    const option =
      this.manualLabelOptions.find((o) => o.id === this.manualLabelId()) ??
      this.manualLabelOptions[this.manualLabelOptions.length - 1];
    this.rollLogService.addManual(option.labelKey, {}, amount);
    this.manualAmount.set(null);
    void this.liveAnnouncer.announce(t('sheet.roll.announce.manual', { total: amount }));
  }

  protected onClear(): void {
    this.rollLogService.clear();
  }
}
