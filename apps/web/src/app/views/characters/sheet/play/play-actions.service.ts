import { computed, inject, Injectable } from '@angular/core';
import { houseRuleAllows, type HouseRuleKey } from '@shared/services/campaigns/house-rules';
import { propose, ProposeError, type NoteEntry, type ProposedEvent, type Sheet } from '@hk/engine';
import {
  NoteAddedV1,
  type ConcentrationEnded,
  type ItemRemoved,
  type ItemUpdated,
  type ResourceRestored,
  type ResourceSpent,
  type SlotRestored,
  type SpellPrepared,
} from '@hk/protocol';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { AuthService } from '@shared/services/auth/auth.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { CampaignEditLockService } from '@shared/services/campaigns/campaign-edit-lock';
import { diagnosticKey } from '@shared/helpers/diagnostic-toast';
import { uuidv7 } from '@shared/helpers/uuid';
import { cryptoRng } from '@shared/services/engine/rng';
import {
  CharacterStore,
  CharacterStoreNotLeaderError,
  type DraftEvent,
} from '@shared/stores/character.store';
import { rollChargeRegains } from './charge-regain-rolls';
import { AddItemDialogComponent, type AddItemDialogResult } from './add-item-dialog.component';
import {
  CastDialogComponent,
  type CastDialogData,
  type CastDialogSummary,
  type CastDialogResult,
  type CastDialogSlotOption,
} from './cast-dialog.component';
import {
  ConditionDialogComponent,
  type ConditionDialogData,
  type ConditionDialogOption,
  type ConditionDialogResult,
} from './condition-dialog.component';
import {
  CustomItemDialogComponent,
  type CustomItemDialogData,
  type CustomItemDialogResult,
} from './custom-item-dialog.component';
import type { NoteEditorResult } from './notes-drawer/note-editor.component';
import { ItemRemoveConfirmComponent, NoteDeleteConfirmComponent } from './play-confirms';
import {
  RestDialogComponent,
  type RestDialogData,
  type RestDialogHitDieOption,
  type RestDialogResult,
} from './rest-dialog.component';

export type DeathSaveResult = 'success' | 'failure' | 'critSuccess' | 'critFailure';
export type Denomination = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
export const DENOMINATIONS: readonly Denomination[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

type SpellcastingBlock = Sheet['spellcasting'][number];
type ResourceView = Sheet['resources'][number];
export type InventoryRow = Sheet['inventory'][number];

/** A known/prepared spell resolved against the content index (`level`/`concentration` read off the
 * spell ENTITY, never inferred). */
export interface SpellRow {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly concentration: boolean;
  /** The spell's facts for the cast dialog's summary chips (absent for a stale id). */
  readonly summary?: CastDialogSummary;
}

// task-3-brief.md extends this set: `propose.spendSlot`/`propose.cast` are the first proposers that
// DO throw. Every other refusal still falls back to `validation.generic` via `diagnosticKey`.
const KNOWN_PROPOSE_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'slot.none-left',
  'attune.max',
  'spell.always-prepared',
  // Plan 13 task 4: the free-cast lane's refusals.
  'resource.none-left',
  'spell.free-cast-unavailable',
  // Plan 13 task 6: `propose.rest`'s rolled charge-regain refusals.
  'rest.regain-roll-missing',
  'rest.regain-roll-invalid',
]);

/**
 * Every mutation the character sheet's leaves make — the sheet strap, the HP gauge, the spell,
 * resource, condition and bag leaves — in ONE place instead of one copy per leaf. It was
 * `PlayTabComponent`'s private handler set; the logic is unchanged and still calls the same engine
 * `propose.*` functions and `CharacterStore.appendTx`. Provided in root: nothing here resolves a
 * pack name (callers pass already-resolved text), so it does not need the sheet's scoped
 * `EngineFacade`.
 */
@Injectable({ providedIn: 'root' })
export class PlayActionsService {
  private readonly characterStore = inject(CharacterStore);
  private readonly toastService = inject(ToastService);
  private readonly authService = inject(AuthService);
  private readonly dialogService = inject(DialogService);

  // --- Campaign edit lock (plan-10 task-14-brief.md, ruling 7) ---------------------------------
  private readonly campaignEditLockService = inject(CampaignEditLockService);
  /** Reactive, cross-stream lock verdict for THIS character's linked campaign (if any). */
  readonly editLock = this.campaignEditLockService.editLockFor(this.characterStore.events);
  /** What every mutating control gates on. Rolling dice stays enabled (ruling 7's boundary). */
  readonly editLocked = computed(() => this.editLock().locked);

  /** Plan 18 task 3: whether the linked campaign's house rule denies `rule` (never for a solo hero). */
  denies(rule: HouseRuleKey): boolean {
    return !houseRuleAllows(rule, this.characterStore.campaign(), this.authService.user()?.userId);
  }
  /** The linked campaign's name, for the house-rule hints. */
  readonly campaignName = computed(() => this.characterStore.campaign()?.name ?? '');

  /** `Facts.notes` — freeform stream state with no derived-`Sheet` projection. */
  readonly notes = computed<NoteEntry[]>(() => this.characterStore.facts()?.notes ?? []);

  /** The protocol schema's own `NoteAdded.body` cap, so the note editor's guard is not a duplicate. */
  readonly noteBodyMaxLength = NoteAddedV1.shape.body.unwrap().maxLength ?? Number.MAX_SAFE_INTEGER;

  private sheet(): Sheet | undefined {
    return this.characterStore.sheet();
  }

  // Every `propose.*` call funnels through here ("ProposeError -> toast"): building the drafts is
  // synchronous, so a `ProposeError` is caught right here. Returns whether the proposal was
  // accepted, so callers that reset UI state only do so on success.
  private tryPropose(build: () => ProposedEvent[]): boolean {
    try {
      this.submitAppendTx(this.characterStore.appendTx(build()));
      return true;
    } catch (error) {
      if (!(error instanceof ProposeError)) throw error;
      const code = error.diagnostics[0]?.code;
      const key =
        code !== undefined
          ? diagnosticKey(code, KNOWN_PROPOSE_DIAGNOSTIC_CODES)
          : 'validation.generic';
      this.toastService.show(`characters.${key}`);
      return false;
    }
  }

  // Fire-and-forget still observes the rejection: a `CharacterStoreNotLeaderError` (another tab
  // holds the write lock) toasts its own `code`; any other rejection is swallowed.
  private submitAppendTx(pending: Promise<void>): void {
    pending.catch((error: unknown) => {
      if (error instanceof CharacterStoreNotLeaderError) {
        this.toastService.show(error.code);
      }
    });
  }

  // Hand-assembled `DraftEvent`s never throw (there is no engine-side refusal to catch).
  private appendDraft(drafts: DraftEvent[]): void {
    this.submitAppendTx(this.characterStore.appendTx(drafts));
  }

  // --- HP, death saves, inspiration -------------------------------------------------------------

  /** Damage/heal/temp-HP share one "no-op below 1" guard; returns whether it was accepted. */
  damage(amount: number): boolean {
    return this.applyHpChange(amount, (sheet, n) => propose.damage(sheet, n));
  }

  heal(amount: number): boolean {
    return this.applyHpChange(amount, (sheet, n) => propose.heal(sheet, n));
  }

  addTemp(amount: number): boolean {
    return this.applyHpChange(amount, (sheet, n) => propose.tempHp(sheet, n));
  }

  private applyHpChange(
    amount: number,
    build: (sheet: Sheet, amount: number) => ProposedEvent[],
  ): boolean {
    const sheet = this.sheet();
    if (!sheet || amount < 1) return false;
    return this.tryPropose(() => build(sheet, amount));
  }

  deathSave(result: DeathSaveResult): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.deathSave(sheet, result));
  }

  toggleInspiration(): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.inspiration(sheet, !sheet.inspiration));
  }

  endConcentration(): void {
    this.appendDraft([
      { type: 'concentration.ended', v: 1, payload: {} satisfies ConcentrationEnded },
    ]);
  }

  // --- Rest -------------------------------------------------------------------------------------

  // CANONICAL REST FLOW: hit-dice healing is collected INSIDE `RestDialogComponent` (one
  // `propose.spendHitDie` draft per die rolled); this concatenates those with
  // `propose.rest(sheet, 'short', undefined, regainRolls)` into ONE `appendTx`, so the whole rest
  // shares a single `txId` in the timeline. The sheet is re-read AFTER the dialog closes.
  async shortRest(hitDiceOptions: RestDialogHitDieOption[]): Promise<void> {
    const openSheet = this.sheet();
    if (!openSheet) return;
    const handle = this.dialogService.open(RestDialogComponent, {
      data: { kind: 'short', sheet: openSheet, hitDiceOptions } satisfies RestDialogData,
    });
    const result = (await handle.closed) as RestDialogResult | undefined;
    if (result?.kind !== 'short') return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => [
      ...result.drafts,
      ...propose.rest(sheet, 'short', undefined, rollChargeRegains(sheet, cryptoRng)),
    ]);
  }

  // A long rest never spends hit dice one at a time: a confirm dialog, then a single
  // `propose.rest(sheet, 'long', undefined, regainRolls)` (plan 13 task 6: dice-regain items are
  // rolled here with `cryptoRng`; the engine records each total, it never rolls).
  async longRest(): Promise<void> {
    const openSheet = this.sheet();
    if (!openSheet) return;
    const handle = this.dialogService.open(RestDialogComponent, {
      data: { kind: 'long', sheet: openSheet, hitDiceOptions: [] } satisfies RestDialogData,
    });
    const result = (await handle.closed) as RestDialogResult | undefined;
    if (result?.kind !== 'long') return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.rest(sheet, 'long', undefined, rollChargeRegains(sheet, cryptoRng)),
    );
  }

  // --- Slots, resources, prepare/cast ----------------------------------------------------------

  spendSlot(level: number): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.spendSlot(sheet, level));
  }

  // `slot.restored` with no `count` defaults to a SINGLE-slot decrement: one pip, one unit.
  restoreSlot(level: number): void {
    this.appendDraft([{ type: 'slot.restored', v: 1, payload: { level } satisfies SlotRestored }]);
  }

  // The pact lane is a SEPARATE propose lane (`opts.pact: true`), never a fallback.
  spendPactSlot(level: number): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.spendSlot(sheet, level, { pact: true }));
  }

  restorePactSlot(level: number): void {
    this.appendDraft([
      { type: 'slot.restored', v: 1, payload: { level, pact: true } satisfies SlotRestored },
    ]);
  }

  spendResource(resourceId: string): void {
    this.appendDraft([
      { type: 'resource.spent', v: 1, payload: { resourceId } satisfies ResourceSpent },
    ]);
  }

  // Deliberate divergence from `resource.restored`'s OMITTED-count default (a FULL reset): a single
  // click restores exactly ONE use, so `count: 1` is explicit.
  restoreResource(resourceId: string): void {
    this.appendDraft([
      {
        type: 'resource.restored',
        v: 1,
        payload: { resourceId, count: 1 } satisfies ResourceRestored,
      },
    ]);
  }

  // Returns whether the change was made (a refused or capped one toasts and returns false).
  // The ENGINE applies no cap on `spell.prepared`; `preparedMax` is read-model only, so this is the
  // only place the cap can be enforced. `block.prepared` INCLUDES always-prepared grants, which do
  // not count against the cap, and unpreparing goes through `propose.unprepare` so the engine's own
  // `spell.always-prepared` refusal surfaces as a toast.
  togglePrepared(block: SpellcastingBlock, spellId: string): boolean {
    if (block.prepared.includes(spellId)) {
      const sheet = this.sheet();
      if (!sheet) return false;
      return this.tryPropose(() => propose.unprepare(sheet, block.classId, spellId));
    }
    const preparedCount = block.prepared.length - (block.alwaysPrepared?.length ?? 0);
    if (block.preparedMax !== undefined && preparedCount >= block.preparedMax) {
      this.toastService.show('characters.sheet.spellcasting.preparedMaxReached', {
        max: block.preparedMax,
      });
      return false;
    }
    this.appendDraft([
      {
        type: 'spell.prepared',
        v: 1,
        payload: { spellId, classId: block.classId } satisfies SpellPrepared,
      },
    ]);
    return true;
  }

  // R-pf3: a cantrip casts DIRECTLY, no dialog — `level: 0, useSlot: false`.
  castCantrip(spellId: string, concentration: boolean): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.cast(sheet, spellId, { level: 0, useSlot: false, concentration }),
    );
  }

  // Opens `CastDialogComponent` for a slot-level pick. `availableSlots` is filtered here, never in
  // the dialog. The sheet is re-read AFTER the dialog closes so `propose.cast` validates against
  // the CURRENT sheet; a slot spent out from under an open dialog surfaces as a genuine
  // `'slot.none-left'` refusal. The pact lane is a SEPARATE option (`pact.level >= row.level`); a
  // pact spend's `opts.level` is the SPELL's own base level. Plan 13 task 4: one free-cast option
  // per `sheet.freeCasts` entry whose resource still has a use, labelled by the caller.
  async castLeveled(
    block: SpellcastingBlock,
    row: SpellRow,
    resourceLabel: (resource: ResourceView) => string,
  ): Promise<void> {
    // A slot level with none left stays in the list as a disabled lane (its seals all spent), so
    // the player sees why it cannot pay; the dialog never lets it be chosen.
    const regularOptions: CastDialogSlotOption[] = block.slots
      .filter((s) => s.level >= row.level)
      .map((s) => ({
        level: s.level,
        max: s.max,
        used: s.used,
        ...(s.used >= s.max ? { spent: true } : {}),
      }));
    const pact = block.pact;
    const pactOptions: CastDialogSlotOption[] =
      pact && pact.level >= row.level && pact.used < pact.count
        ? [{ level: pact.level, max: pact.count, used: pact.used, pact: true }]
        : [];
    const current = this.sheet();
    const freeOptions: CastDialogSlotOption[] = (current?.freeCasts ?? []).flatMap((free) => {
      const resource = current?.resources.find((r) => r.id === free.resourceId);
      return free.spellId === row.id && resource && resource.used < resource.max.value
        ? [
            {
              level: free.level,
              max: resource.max.value,
              used: resource.used,
              freeResource: resource.id,
              freeLabel: resourceLabel(resource),
            },
          ]
        : [];
    });
    const handle = this.dialogService.open(CastDialogComponent, {
      data: {
        spellName: row.name,
        spellLevel: row.level,
        spellConcentration: row.concentration,
        ...(row.summary ? { summary: row.summary } : {}),
        availableSlots: [...regularOptions, ...pactOptions, ...freeOptions],
        alreadyConcentrating: current?.concentration !== undefined,
      } satisfies CastDialogData,
    });
    const result = (await handle.closed) as CastDialogResult | undefined;
    if (!result) return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.cast(sheet, row.id, {
        level: result.pact ? row.level : result.level,
        concentration: row.concentration,
        ...(result.pact ? { pact: true } : {}),
        ...(result.freeResource !== undefined ? { freeResource: result.freeResource } : {}),
      }),
    );
  }

  // --- Conditions, notes ------------------------------------------------------------------------

  async addCondition(options: ConditionDialogOption[]): Promise<void> {
    // The house-rule guard sits here so every entry point (leaf, strap, ...) obeys it.
    if (options.length === 0 || this.denies('playersManageConditions')) return;
    const handle = this.dialogService.open(ConditionDialogComponent, {
      data: {
        options,
        roundsWaitForEncounter: !this.solo() && !this.clock(),
      } satisfies ConditionDialogData,
    });
    const result = (await handle.closed) as ConditionDialogResult | undefined;
    if (!result) return;
    // The campaign read polls every 15 s; read the DM's clock fresh so a round just advanced counts.
    try {
      await this.characterStore.campaign.refresh();
    } catch {
      // Keep the condition (it starts on the last polled clock) and say the clock could not be read.
      this.toastService.show('characters.sheet.conditions.refreshFailed');
    }
    const sheet = this.sheet();
    if (!sheet) return;
    const clock = this.clock();
    const timing =
      result.rounds === undefined
        ? undefined
        : {
            duration: { kind: 'rounds' as const, amount: result.rounds },
            // A solo hero before its first Advance round is implicitly in round 1.
            ...(clock ? { startedAtRound: clock.round, encounterId: clock.id } : {}),
            ...(!clock && this.solo() ? { startedAtRound: 1 } : {}),
          };
    this.tryPropose(() => propose.condition(sheet, result.conditionId, true, result.level, timing));
  }

  /** Plan 18 task 2: a solo (unlinked) hero keeps its own round counter. */
  readonly solo = computed(() => this.characterStore.campaignOverrides().clock === undefined);

  /** The clock a new rounds condition starts on: the campaign's open encounter, or the solo hero's. */
  readonly clock = computed<{ id: string; round: number } | null>(() => {
    const campaignClock = this.characterStore.campaignOverrides().clock;
    if (campaignClock) return campaignClock.encounter ?? null;
    const round = this.characterStore.facts()?.round;
    return round ? { id: round.encounterId, round: round.round } : null;
  });

  /** Solo "Advance round": round 1 is implicit, so the first advance mints the encounter at round 2. */
  advanceSoloRound(): void {
    const round = this.characterStore.facts()?.round;
    const payload = { encounterId: round?.encounterId ?? uuidv7(), round: (round?.round ?? 1) + 1 };
    this.submitAppendTx(
      this.characterStore.appendTx([{ type: 'combat.round_advanced', v: 1, payload }]),
    );
  }

  removeCondition(conditionId: string): void {
    if (this.denies('playersManageConditions')) return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.condition(sheet, conditionId, false));
  }

  // `propose.note` takes no `Sheet` — every note action fires straight through `appendDraft`.

  /** Appends `note.added` for the editor's saved fields (the notes drawer owns the form). */
  createNote(result: NoteEditorResult): void {
    this.appendDraft(
      propose.note('added', { id: uuidv7(), title: result.title, body: result.body }),
    );
  }

  /** Appends `note.updated` for an existing note. */
  updateNote(id: string, result: NoteEditorResult): void {
    this.appendDraft(propose.note('updated', { id, title: result.title, body: result.body }));
  }

  /** Asks first; resolves whether the note was actually removed. */
  async removeNote(note: NoteEntry): Promise<boolean> {
    const handle = this.dialogService.open(NoteDeleteConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return false;
    this.appendDraft(propose.note('removed', { id: note.id }));
    return true;
  }

  // --- Inventory and currency -------------------------------------------------------------------

  async addFromLibrary(): Promise<void> {
    const handle = this.dialogService.open(AddItemDialogComponent, { sheet: true });
    const result = (await handle.closed) as AddItemDialogResult | undefined;
    if (!result) return;
    this.addLibraryItem(result.itemId, result.qty);
  }

  /** Puts a library item (`itemId` is a pack entity id) into the bag; the add-from-library dialog
   * and the library's "Add to hero" share it. Returns whether the proposal was accepted. */
  addLibraryItem(itemId: string, qty = 1): boolean {
    if (this.denies('playersAddItems')) return false;
    const sheet = this.sheet();
    if (!sheet) return false;
    return this.tryPropose(() => propose.addItem(sheet, { itemId, qty }, uuidv7));
  }

  // Ruling 2: a custom item's `item.added` draft carries `custom: {}` and NO `itemId`. `notes` is
  // not part of `ItemAdded`, so a non-blank notes field becomes a SECOND `item.updated` draft
  // sharing the SAME `instanceId`, concatenated into one `tryPropose` call (one `txId`).
  // `used` (the bag's game-icon slugs, listed first in the picker) comes from the caller, which
  // resolves pack icons through the sheet's scoped `EngineFacade` (see the class doc).
  async addCustomItem(used: readonly string[] = []): Promise<void> {
    if (this.denies('playersAddItems')) return;
    const handle = this.dialogService.open(CustomItemDialogComponent, {
      data: { used } satisfies CustomItemDialogData,
    });
    const result = (await handle.closed) as CustomItemDialogResult | undefined;
    if (!result) return;
    const sheet = this.sheet();
    if (!sheet) return;
    const instanceId = uuidv7();
    this.tryPropose(() => {
      const drafts = propose.addItem(
        sheet,
        { name: result.name, qty: result.qty, custom: result.icon ? { icon: result.icon } : {} },
        () => instanceId,
      );
      if (result.notes) {
        drafts.push({
          type: 'item.updated',
          v: 1,
          payload: { instanceId, notes: result.notes } satisfies ItemUpdated,
        });
      }
      return drafts;
    });
  }

  toggleEquip(row: InventoryRow): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.equip(sheet, row.instanceId, !row.equipped));
  }

  // `propose.attune` refuses past `sheet.attunementMax` ('attune.max'), toasted by `tryPropose`.
  toggleAttune(row: InventoryRow): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.attune(sheet, row.instanceId, !row.attuned));
  }

  // `item.updated{qty}` REPLACES the stored qty (never a delta), so both directions send the new
  // total; removing a stack down to 0 is the Remove button's job.
  increaseQty(row: InventoryRow): void {
    this.setQty(row, row.qty + 1);
  }

  decreaseQty(row: InventoryRow): void {
    if (row.qty <= 1) return;
    this.setQty(row, row.qty - 1);
  }

  private setQty(row: InventoryRow, qty: number): void {
    this.appendDraft([
      {
        type: 'item.updated',
        v: 1,
        payload: { instanceId: row.instanceId, qty } satisfies ItemUpdated,
      },
    ]);
  }

  // Using one of a stack: the quantity goes down by one; the last one removes the entry (no
  // `qty` in `item.removed` means "remove the whole entry").
  useOne(row: InventoryRow): void {
    if (row.qty > 1) {
      this.setQty(row, row.qty - 1);
      return;
    }
    // Using the last one removes the entry, so it confirms like Remove does.
    void this.removeItem(row);
  }

  // Behind its own confirm dialog (`ItemRemoveConfirmComponent`).
  async removeItem(row: InventoryRow): Promise<void> {
    const handle = this.dialogService.open(ItemRemoveConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    this.appendDraft([
      { type: 'item.removed', v: 1, payload: { instanceId: row.instanceId } satisfies ItemRemoved },
    ]);
  }

  // `propose.currency` takes DELTAS, not totals: `draft - current` per denomination, straight off
  // the live `sheet().currency`. An untouched denomination nets to zero and is left out of the
  // payload. Returns whether the proposal was accepted (the caller then resets its draft).
  applyCurrency(draft: Sheet['currency']): boolean {
    const sheet = this.sheet();
    if (!sheet) return false;
    const deltas: Partial<Sheet['currency']> = {};
    for (const denom of DENOMINATIONS) {
      const delta = draft[denom] - sheet.currency[denom];
      if (delta !== 0) deltas[denom] = delta;
    }
    if (Object.keys(deltas).length === 0) return false;
    return this.tryPropose(() => propose.currency(sheet, deltas));
  }
}
