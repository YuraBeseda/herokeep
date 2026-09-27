import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
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
import {
  ConditionDialogComponent,
  type ConditionDialogData,
  type ConditionDialogOption,
  type ConditionDialogResult,
} from '../../characters/sheet/play/condition-dialog.component';

/** One resolved "currently active" condition row (`activeConditionIds()` resolved to a display
 * name) — for the panel's own remove-chip list, mirroring `PlayTabComponent.conditions()`'s row
 * shape without a `level` column (the panel has no per-condition level display, only add/remove;
 * a re-add with a new level via `onAddCondition` still replaces the entry, per the reducer's own
 * replace-by-`conditionId` semantics — `packages/engine/src/reduce/handlers/vitals.ts`). */
interface ActiveConditionRow {
  readonly id: string;
  readonly name: string;
}

/**
 * `DmEffectsPanelComponent` (plan-10 task-11-brief.md) — the DM effects panel: damage/heal/temp
 * HP, condition add/remove, inspiration toggle, XP/level grant (gated by `houseRules.xpMode`),
 * item grant, and a manual override, ALL via `CampaignStore.gatewayAppend` (doc-03's cross-stream
 * gateway forward — the DM never owns the target character, so this can never go through a local
 * `CharacterStore.appendTx`). Mounts on the party card (`PartyTabComponent`, works in 'overview'
 * mode off `state.overviews`) AND inside `MemberSheetDialogComponent` ('full' mode, off the live
 * subscribed `Sheet` — task-9-report.md's documented seam). DM-only rendering is the OPENER's job
 * (both callers already gate on `isDm()`/the drill-in's own DM-only affordance) — this component
 * trusts it was only ever mounted for an authorized viewer, same "the caller already checked"
 * posture `MemberSheetDialogComponent` itself documents.
 *
 * ## HP delta composition (`shared/services/campaigns/dm-effects.ts`)
 *
 * `hp()` is `undefined` whenever the caller has no baseline to clamp against (a roster entry with
 * no `party.overview_updated` yet) — the HP section renders disabled in that case rather than
 * guessing. Where a baseline exists, `dm-effects.ts`'s builders replicate
 * `packages/engine/src/propose/vitals.ts`'s own damage/heal clamping so the reducer never floors/
 * overheals in a way the DM's typed amount didn't actually intend (see that module's own class
 * doc for the full `hp.changed`, delta-vs-absolute finding).
 *
 * ## Inline feedback
 *
 * Every action funnels through the private `send()` helper, which resolves `gatewayAppend`'s own
 * `AckOrReject` into `feedbackOk`/`feedbackMessage` — shown inline (`role="status"`) IN ADDITION
 * to the generic per-code toast `StreamSyncSession`'s own `REJECT_TOAST_KEYS` channel already
 * raises for ANY gateway reject (task-11-brief.md's own instruction: "the panel should ALSO
 * reflect per-effect success/failure inline").
 *
 * ## Fix round 1 — honest overview-mode damage/heal feedback
 *
 * A server ACK only means the event was accepted and appended — NOT that the reducer's own effect
 * actually applied. `hp.changed{kind:'damage'|'heal'}` skips with `'hp-unresolved'` when the
 * character's underlying `facts.hp.current` is still the long-rest `'max'` sentinel (`dm-
 * effects.ts`'s own delta-vs-absolute class doc), and `HpSnapshot.currentWasMax` — the ONLY signal
 * that could tell this component whether that's the case — is only ever knowable from a live
 * `Sheet` (`MemberSheetDialogComponent`'s 'full' mode). The party card's 'overview' mode
 * (`PartyOverview`, no such field in `PartyOverviewUpdatedV1`) STRUCTURALLY cannot know either way
 * — `hp().currentWasMax` reads `undefined` there, not `false`. Telling the DM "Applied." on an ACK
 * in that blind spot is dishonest: the event may have silently no-opped.
 *
 * Fix: `applyDamage`/`applyHeal` pass `caveatIfUnresolvedSentinel: hp.currentWasMax === undefined`
 * to `send()`; on a successful ack, `feedbackCaveated` is set from that flag and the template picks
 * `dmEffects.status.appliedCaveat` (a caveated "sent, but may not have applied yet" phrasing)
 * instead of the plain `dmEffects.status.applied`. Every OTHER action (temp HP — never reads prior
 * state; inspiration/condition/xp/level/item/override — no sentinel concept at all) always passes
 * no caveat and keeps the plain success message. A REJECT is unaffected either way (still the
 * plain `dmEffects.status.failed`) — the caveat is specifically about a MISLEADING SUCCESS, not
 * failure, which is already accurate.
 */
@Component({
  selector: 'app-dm-effects-panel',
  imports: [
    TranslocoDirective,
    FormsModule,
    ButtonComponent,
    ChipComponent,
    NumberFieldComponent,
    SheetSectionComponent,
  ],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './dm-effects-panel.component.html',
  styleUrl: './dm-effects-panel.component.scss',
})
export class DmEffectsPanelComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);

  // Inputs
  /** Bare character uuid — `CampaignStore.gatewayAppend`'s own first parameter shape. */
  readonly characterId = input.required<string>();
  /** `undefined` when no HP baseline is available yet (see class doc). */
  readonly hp = input<HpSnapshot | undefined>(undefined);
  /** The character's currently-known active condition ids (from `PartyOverview.conditions` or a
   * live `Sheet.conditions`), for the remove-chip list. */
  readonly activeConditionIds = input<readonly string[]>([]);

  // Panel chrome
  protected readonly expanded = signal(false);
  protected readonly busy = signal(false);
  protected readonly feedbackOk = signal<boolean | undefined>(undefined);
  protected readonly feedbackMessage = signal<string | undefined>(undefined);
  /** `true` only alongside a successful (`feedbackOk() === true`) damage/heal ack sent WITHOUT
   * sentinel certainty (fix round 1 — see class doc). Meaningless/ignored whenever `feedbackOk()`
   * isn't `true`. */
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

  // Panel chrome

  protected toggle(): void {
    this.expanded.update((value) => !value);
  }

  // HP

  protected onDamageAmountChange(value: number | null): void {
    this.damageAmount.set(value);
  }

  protected onHealAmountChange(value: number | null): void {
    this.healAmount.set(value);
  }

  protected onTempAmountChange(value: number | null): void {
    this.tempAmount.set(value);
  }

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

  protected onXpAmountChange(value: number | null): void {
    this.xpAmount.set(value);
  }

  protected onXpReasonChange(value: string): void {
    this.xpReason.set(value);
  }

  protected async grantXp(): Promise<void> {
    const amount = this.xpAmount();
    if (amount === null || amount === 0) return;
    const reason = this.xpReason().trim();
    await this.send([xpAwardedDraft(amount, reason || undefined)]);
    this.xpReason.set('');
  }

  protected onLevelCountChange(value: number | null): void {
    this.levelCount.set(value);
  }

  protected async grantLevel(): Promise<void> {
    const count = this.levelCount();
    if (count === null || count < 1) return;
    await this.send([levelGrantedDraft(count)]);
  }

  // Item grant

  protected onItemNameChange(value: string): void {
    this.itemName.set(value);
  }

  protected onItemQtyChange(value: number | null): void {
    this.itemQty.set(value);
  }

  protected async grantItem(): Promise<void> {
    const qty = this.itemQty();
    if (qty === null || qty < 1) return;
    const name = this.itemName().trim();
    await this.send([itemGrantDraft(uuidv7(), qty, name)]);
    this.itemName.set('');
  }

  // Override

  protected onOverridePathChange(value: string): void {
    this.overridePath.set(value);
  }

  protected onOverrideValueChange(value: string): void {
    this.overrideValue.set(value);
  }

  protected onOverrideReasonChange(value: string): void {
    this.overrideReason.set(value);
  }

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
   * back to the raw string verbatim otherwise (a bare word like `str` for a path-shaped value
   * isn't valid JSON on its own). An empty field becomes `''` (schema-valid — `OverrideAppliedV1.
   * value` is `z.unknown()`), never `undefined` (that would need an explicit key omission, and
   * `strictObject` requires every declared key present). */
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
