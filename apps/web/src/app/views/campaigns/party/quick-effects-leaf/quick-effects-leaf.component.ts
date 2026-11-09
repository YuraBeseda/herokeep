import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { uuidv7 } from '@shared/helpers/uuid';
import {
  conditionDraft,
  damageDraft,
  healDraft,
  inspirationDraft,
  itemGrantDraft,
  levelGrantedDraft,
  overrideAppliedDraft,
  tempHpDraft,
  xpAwardedDraft,
  type HpSnapshot,
} from '@shared/services/campaigns/dm-effects';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignStore } from '@shared/stores/campaign.store';
import type { DraftEvent } from '@shared/stores/character.store';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkIconButtonComponent } from '../../../../ui/icon-button/icon-button.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkNumberFieldComponent } from '../../../../ui/number-field/number-field.component';
import { HkTextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { DialogService } from '../../../../ui/dialog/dialog.service';
import {
  ConditionDialogComponent,
  type ConditionDialogData,
  type ConditionDialogOption,
  type ConditionDialogResult,
} from '../../../characters/sheet/play/condition-dialog.component';
import {
  CampaignSelectionService,
  type EffectRequest,
} from '../../shell/campaign-selection.service';

/** The nine quick effects, in the order of board C06's tab row. */
export type EffectTab =
  'damage' | 'heal' | 'temp' | 'condition' | 'xp' | 'level' | 'item' | 'inspiration' | 'override';

const TAB_ICONS: Record<EffectTab, string> = {
  damage: 'ui:damage',
  heal: 'ui:heal',
  temp: 'ui:temp-hp',
  condition: 'ui:condition',
  xp: 'ui:xp',
  level: 'ui:level-up',
  item: 'ui:bag',
  inspiration: 'ui:inspiration',
  override: 'ui:edit',
};

const TAB_ORDER: readonly EffectTab[] = [
  'damage',
  'heal',
  'temp',
  'condition',
  'xp',
  'level',
  'item',
  'inspiration',
  'override',
];

let nextLeafId = 0;

/** One resolved "currently active" condition row, for the remove-chip list. */
interface ActiveConditionRow {
  readonly id: string;
  readonly name: string;
}

/**
 * `QuickEffectsLeafComponent` (board C06's leaf, plan 17 B11b; it replaces the old DM effects
 * panel): the DM's effects for ONE member, as a paper leaf with a row of nine effect tabs
 * (Damage, Heal, Temp HP, Condition, XP, Level, Item, Inspiration, Override) and the form of the
 * chosen one. Every effect goes through `CampaignStore.gatewayAppend` (doc-03's cross-stream
 * gateway forward: the DM never owns the target character, so it can never be a local append) with
 * exactly the drafts the panel built before: `dm-effects.ts` clamps HP the way the engine does.
 *
 * It mounts beside the party grid (`PartyTabComponent`, 'overview' mode off `state.overviews`) and,
 * `embedded`, inside the member drawer ('full' mode, off the live subscribed sheet). DM-only
 * rendering is the OPENER's job: both callers gate on the DM.
 *
 * ## XP and Level
 *
 * Both tabs are always drawn, as on the board, but only the one `houseRules.xpMode` selects works:
 * the other is `aria-disabled` with the reason as its tooltip and description (never printed).
 *
 * ## Strap requests
 *
 * The campaign strap posts a request for a member (`CampaignSelectionService`); the leaf of the
 * addressed member takes it (consume-once) and runs the same action its own tab runs: it picks the
 * tab and focuses its first field, or, for Condition, opens the condition picker.
 *
 * ## Honest overview-mode damage/heal feedback
 *
 * A server ACK only means the event was appended, not that the reducer applied it:
 * `hp.changed{damage|heal}` skips with 'hp-unresolved' while `facts.hp.current` is still the
 * long-rest 'max' sentinel, which only a live sheet (`HpSnapshot.currentWasMax`) can reveal. In
 * 'overview' mode `currentWasMax` is `undefined`, so a successful damage/heal shows the caveated
 * "sent, applies once HP is initialized" message instead of a plain "Applied.". A reject is
 * unaffected.
 *
 * ## Names (plan 16 Task 5, design ruling 6)
 *
 * Condition names resolve through the injected `EngineFacade`: in the member drawer that is the
 * drawer's facade scoped to the member's own pins, beside the grid it is the root facade (core).
 */
@Component({
  selector: 'app-quick-effects-leaf',
  imports: [
    TranslocoDirective,
    FormsModule,
    IconComponent,
    HkButtonComponent,
    HkIconButtonComponent,
    HkLeafComponent,
    HkNumberFieldComponent,
    HkTextFieldComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('campaigns')],
  host: { '(keydown.escape)': 'onEscape($event)' },
  templateUrl: './quick-effects-leaf.component.html',
  styleUrl: './quick-effects-leaf.component.scss',
})
export class QuickEffectsLeafComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);
  private readonly selection = inject(CampaignSelectionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  // Inputs
  /** Bare character uuid: `CampaignStore.gatewayAppend`'s own first parameter shape. */
  readonly characterId = input.required<string>();
  /** The member's name (the leaf's heading beside the grid). */
  readonly name = input('');
  /** `undefined` when no HP baseline is available yet (see class doc). */
  readonly hp = input<HpSnapshot | undefined>(undefined);
  /** The member's currently-known active condition ids, for the remove-chip list. */
  readonly activeConditionIds = input<readonly string[]>([]);
  /** In the member drawer: no member heading, close button or footer actions. */
  readonly embedded = input(false);
  /** Footer actions, each offered by the party view only where it applies. */
  readonly canOpenSheet = input(false);
  readonly canHandOver = input(false);
  readonly canUnlink = input(false);

  readonly closed = output<void>();
  readonly openSheet = output<void>();
  readonly handOver = output<void>();
  readonly unlink = output<void>();

  protected readonly leafId = `qfx-${nextLeafId++}`;
  protected readonly tab = signal<EffectTab>('damage');
  protected readonly busy = signal(false);
  protected readonly feedbackOk = signal<boolean | undefined>(undefined);
  protected readonly feedbackMessage = signal<string | undefined>(undefined);
  /** `true` only alongside a successful damage/heal ack sent WITHOUT sentinel certainty. */
  protected readonly feedbackCaveated = signal(false);

  // HP
  protected readonly damageAmount = signal<number | null>(1);
  protected readonly healAmount = signal<number | null>(1);
  protected readonly tempAmount = signal<number | null>(1);
  protected readonly canApplyHp = computed(() => this.hp() !== undefined);

  // Conditions
  protected readonly conditionOptions = computed<ConditionDialogOption[]>(() => {
    const index = this.engineFacade.index();
    return index
      .system()
      .conditions.map((id) => {
        const entity = index.get(id);
        const levelBearing =
          (entity?.type === 'condition' ? entity.levels : undefined) !== undefined;
        return { id, name: this.resolveName(id), levelBearing };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly activeConditionRows = computed<ActiveConditionRow[]>(() =>
    this.activeConditionIds().map((id) => ({ id, name: this.resolveName(id) })),
  );

  // XP / level
  protected readonly xpMode = computed(
    () => this.campaignStore.state()?.settings?.houseRules.xpMode ?? 'xp',
  );
  protected readonly xpAmount = signal<number | null>(0);
  protected readonly xpReason = signal('');
  protected readonly levelCount = signal<number | null>(1);

  // Item grant
  protected readonly itemName = signal('');
  protected readonly itemQty = signal<number | null>(1);

  // Override
  protected readonly overridePath = signal('');
  protected readonly overrideValue = signal('');
  protected readonly overrideReason = signal('');
  protected readonly canApplyOverride = computed(
    () => this.overridePath().trim().length > 0 && this.overrideReason().trim().length > 0,
  );

  protected readonly tabIds = TAB_ORDER;
  protected readonly tabIcon = (id: EffectTab): string => TAB_ICONS[id];

  /** The tab the XP/Level pair collapses to under the campaign's XP mode. */
  private readonly xpTab = computed<EffectTab>(() => (this.xpMode() === 'xp' ? 'xp' : 'level'));

  constructor() {
    // The campaign strap's Damage / Heal / Condition / XP / Item for the selected member: the leaf
    // of the addressed member runs the same action its own tab runs. A request for a member this
    // leaf does not address is left on the board.
    effect(() => {
      const request = this.selection.request();
      if (request?.characterId !== this.characterId()) return;
      // Consume-once: taken off the board before it runs, so a leaf mounting later never replays it.
      untracked(() => {
        this.selection.consume(request);
        this.handleRequest(request);
      });
    });
  }

  /** Whether `id` works in this campaign's XP mode (the other of XP and Level does not). */
  protected isOff(id: EffectTab): boolean {
    return (id === 'xp' || id === 'level') && id !== this.xpTab();
  }

  private handleRequest(request: EffectRequest): void {
    if (request.kind === 'condition') {
      this.tab.set('condition');
      void this.onAddCondition();
      return;
    }
    // XP mode shows the XP award, milestone mode the level grant: both answer the strap's XP.
    this.pick(request.kind === 'xp' ? this.xpTab() : request.kind);
  }

  /** Shows `id`'s form and moves focus to its first field. */
  protected pick(id: EffectTab): void {
    if (this.isOff(id)) return;
    this.tab.set(id);
    afterNextRender(
      () => {
        const panel = this.host.nativeElement.querySelector<HTMLElement>('.qfx__panel');
        panel?.scrollIntoView?.({ block: 'nearest' });
        panel?.querySelector<HTMLElement>('input, button')?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Roving arrows between the tabs, Home and End to the ends. */
  protected onTabsKey(event: KeyboardEvent): void {
    const usable = TAB_ORDER.filter((id) => !this.isOff(id));
    const index = usable.indexOf(this.tab());
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % usable.length
        : event.key === 'ArrowLeft'
          ? (index + usable.length - 1) % usable.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? usable.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    this.tab.set(usable[next]);
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(`#${this.leafId}-tab-${usable[next]}`)
        ?.focus(),
    );
  }

  protected onEscape(event: Event): void {
    if (this.embedded() || event.defaultPrevented) return;
    event.preventDefault();
    this.closed.emit();
  }

  // HP

  protected async applyDamage(): Promise<void> {
    const hp = this.hp();
    const amount = this.damageAmount();
    if (!hp || amount === null || amount <= 0) return;
    await this.send(damageDraft(amount, hp), {
      caveatIfUnresolvedSentinel: hp.currentWasMax === undefined,
    });
  }

  protected async applyHeal(): Promise<void> {
    const hp = this.hp();
    const amount = this.healAmount();
    if (!hp || amount === null || amount <= 0) return;
    await this.send(healDraft(amount, hp), {
      caveatIfUnresolvedSentinel: hp.currentWasMax === undefined,
    });
  }

  protected async applyTemp(): Promise<void> {
    const amount = this.tempAmount();
    if (amount === null || amount <= 0) return;
    await this.send(tempHpDraft(amount));
  }

  // Inspiration

  protected async grantInspiration(value: boolean): Promise<void> {
    await this.send([inspirationDraft(value)]);
  }

  // Conditions

  protected async onAddCondition(): Promise<void> {
    const options = this.conditionOptions();
    if (options.length === 0) return;
    const handle = this.dialogService.open(ConditionDialogComponent, {
      data: { options } satisfies ConditionDialogData,
    });
    const result = (await handle.closed) as ConditionDialogResult | undefined;
    if (!result) return;
    await this.send([conditionDraft(result.conditionId, true, result.level)]);
  }

  protected async onRemoveCondition(conditionId: string): Promise<void> {
    await this.send([conditionDraft(conditionId, false)]);
  }

  // XP / level

  protected async grantXp(): Promise<void> {
    const amount = this.xpAmount();
    if (amount === null || amount === 0) return;
    const reason = this.xpReason().trim();
    await this.send([xpAwardedDraft(amount, reason || undefined)]);
    this.xpReason.set('');
  }

  protected async grantLevel(): Promise<void> {
    const count = this.levelCount();
    if (count === null || count < 1) return;
    await this.send([levelGrantedDraft(count)]);
  }

  // Item grant

  protected async grantItem(): Promise<void> {
    const qty = this.itemQty();
    if (qty === null || qty < 1) return;
    const name = this.itemName().trim();
    await this.send([itemGrantDraft(uuidv7(), qty, name)]);
    this.itemName.set('');
  }

  // Override

  protected async applyOverride(): Promise<void> {
    const path = this.overridePath().trim();
    const reason = this.overrideReason().trim();
    if (!path || !reason) return;
    const value = this.parseOverrideValue(this.overrideValue());
    await this.send([overrideAppliedDraft(path, value, reason)]);
    this.overridePath.set('');
    this.overrideValue.set('');
    this.overrideReason.set('');
  }

  // Shared

  private resolveName(id: string): string {
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
  }

  /** A free-typed override value: JSON-parsed when it parses cleanly (numbers, booleans, quoted
   * strings, arrays/objects) so a DM can type `18` or `true` and get the right scalar type; falls
   * back to the raw string verbatim otherwise. An empty field becomes `''` (schema-valid:
   * `OverrideAppliedV1.value` is `z.unknown()`), never `undefined`. */
  private parseOverrideValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === '') return trimmed;
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }

  private async send(
    drafts: DraftEvent[],
    options?: { readonly caveatIfUnresolvedSentinel?: boolean },
  ): Promise<void> {
    this.busy.set(true);
    this.feedbackOk.set(undefined);
    this.feedbackMessage.set(undefined);
    this.feedbackCaveated.set(false);
    try {
      const result = await this.campaignStore.gatewayAppend(this.characterId(), drafts);
      const ok = result.rejected.length === 0;
      this.feedbackOk.set(ok);
      this.feedbackMessage.set(ok ? undefined : result.rejected[0]?.message);
      this.feedbackCaveated.set(ok && options?.caveatIfUnresolvedSentinel === true);
    } catch (err) {
      this.feedbackOk.set(false);
      this.feedbackMessage.set(err instanceof Error ? err.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }
}
