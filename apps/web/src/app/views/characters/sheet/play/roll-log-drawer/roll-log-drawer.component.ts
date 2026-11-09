import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, inject, input, model, signal } from '@angular/core';
import type { CampaignVisibility } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DiceResultComponent } from '@shared/components/dice-result/dice-result.component';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { IconComponent } from '../../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { DialogService } from '../../../../../ui/dialog/dialog.service';
import { HkDrawerComponent } from '../../../../../ui/drawer/drawer.component';
import { HkNumberFieldComponent } from '../../../../../ui/number-field/number-field.component';
import { HkSelectComponent, type SelectOption } from '../../../../../ui/select/select.component';
import { RollLogClearConfirmComponent } from '../play-confirms';
import { PlayRollsService, type AdvantageMode } from '../play-rolls.service';

type Opener = HTMLElement | null | undefined;

interface AdvantageChoice {
  readonly mode: AdvantageMode;
  readonly labelKey: string;
  readonly icon: string | null;
}

const ADVANTAGE_CHOICES: readonly AdvantageChoice[] = [
  { mode: 'adv', labelKey: 'sheet.roll.advantage.advantage', icon: 'ui:advantage' },
  { mode: 'normal', labelKey: 'sheet.roll.advantage.normal', icon: null },
  { mode: 'dis', labelKey: 'sheet.roll.advantage.disadvantage', icon: 'ui:disadvantage' },
];

// The manual-entry row's fixed label choices: a small, closed set of roll KINDS (never free text,
// which would be a user-visible literal outside the Localizer), each a scope-relative Transloco key.
const MANUAL_KINDS = ['check', 'save', 'attack', 'damage', 'other'] as const;

/**
 * The roll-log drawer (board D02), opened from the sheet strap's Roll log action and from the phone
 * More tab. A right-side drawer on tablet and desktop, a full-height sheet on a phone. It holds
 * what the old inline panel held: the advantage segment for the next roll, the visibility picker
 * (only while the sheet is linked to a campaign with a live session), the feed (newest first, via
 * `hk-dice-result`), a block to log a roll rolled at the table, and Clear log, which now asks first
 * (DL05). The sheet's roll buttons read the advantage and visibility signals off `PlayRollsService`,
 * which this drawer writes; it never rolls itself.
 */
@Component({
  selector: 'app-roll-log-drawer',
  imports: [
    TranslocoDirective,
    DiceResultComponent,
    HkButtonComponent,
    HkDrawerComponent,
    HkNumberFieldComponent,
    HkSelectComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './roll-log-drawer.component.html',
  styleUrl: './roll-log-drawer.component.scss',
})
export class RollLogDrawerComponent {
  private readonly rollLogService = inject(RollLogService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly dialogService = inject(DialogService);
  protected readonly rolls = inject(PlayRollsService);

  readonly open = model(false);
  /** The control that opened the drawer: focus returns to it and pressing it never counts as outside. */
  readonly opener = input<Opener>(null);

  protected readonly entries = this.rollLogService.entries;
  protected readonly advantageChoices = ADVANTAGE_CHOICES;
  protected readonly manualAmount = signal<number | null>(null);
  protected readonly manualKind = signal<string | null>('check');

  protected kindOptions(t: (key: string) => string): SelectOption[] {
    return MANUAL_KINDS.map((id) => ({ value: id, label: t(`sheet.roll.manual.labels.${id}`) }));
  }

  protected setAdvantage(mode: AdvantageMode): void {
    this.rolls.advantageMode.set(mode);
  }

  protected setVisibility(visibility: CampaignVisibility): void {
    this.rolls.rollVisibility.set(visibility);
  }

  protected addManual(t: (key: string, params?: Record<string, unknown>) => string): void {
    const amount = this.manualAmount();
    if (amount === null) return;
    const kind = MANUAL_KINDS.find((id) => id === this.manualKind()) ?? 'other';
    this.rollLogService.addManual(`sheet.roll.manual.labels.${kind}`, {}, amount);
    this.manualAmount.set(null);
    void this.liveAnnouncer.announce(t('sheet.roll.announce.manual', { total: amount }));
  }

  protected async clear(): Promise<void> {
    const confirmed = await this.dialogService.open(RollLogClearConfirmComponent).closed;
    if (confirmed === true) this.rollLogService.clear();
  }
}
