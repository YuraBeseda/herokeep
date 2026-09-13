import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SafeHtml } from '@angular/platform-browser';
import {
  DEATH_SAVE_MAX,
  parseRollSpec,
  propose,
  ProposeError,
  roll,
  type ContentIndex,
  type Localizer,
  type NoteEntry,
  type ProposedEvent,
  type Sheet,
} from '@hk/engine';
import {
  makeEntityId,
  NoteAddedV1,
  parseEntityId,
  type ConcentrationEnded,
  type ItemRemoved,
  type ItemUpdated,
  type ResourceRestored,
  type ResourceSpent,
  type SlotRestored,
  type SpellPrepared,
  type SpellUnprepared,
} from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { HpBarComponent } from '@shared/components/hp-bar/hp-bar.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { PipsComponent } from '@shared/components/pips/pips.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { StatTileComponent } from '@shared/components/stat-tile/stat-tile.component';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  DerivedPopoverDirective,
  type DerivedValue,
} from '@shared/directives/derived-popover.directive';
import { diagnosticKey } from '@shared/helpers/diagnostic-toast';
import { uuidv7 } from '@shared/helpers/uuid';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { cryptoRng } from '@shared/services/engine/rng';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { CharacterStore, type DraftEvent } from '@shared/stores/character.store';
import { AddItemDialogComponent, type AddItemDialogResult } from './add-item-dialog.component';
import { CastDialogComponent, type CastDialogData } from './cast-dialog.component';
import {
  ConditionDialogComponent,
  type ConditionDialogData,
  type ConditionDialogOption,
  type ConditionDialogResult,
} from './condition-dialog.component';
import {
  CustomItemDialogComponent,
  type CustomItemDialogResult,
} from './custom-item-dialog.component';
import {
  NoteDialogComponent,
  type NoteDialogData,
  type NoteDialogResult,
} from './note-dialog.component';
import {
  RestDialogComponent,
  type RestDialogData,
  type RestDialogHitDieOption,
  type RestDialogResult,
} from './rest-dialog.component';
import { RollLogPanelComponent, type AdvantageMode } from './roll-log-panel.component';

type DeathSaveResult = 'success' | 'failure' | 'critSuccess' | 'critFailure';

/** Same-content-provider pattern as `TimelineRevertConfirmComponent`
 * (`timeline-tab.component.ts`): `DialogService.open()` attaches this under a NEW injector rooted
 * at the app's root, not `PlayTabComponent`'s own `provideTranslocoScope('characters')` — it reads
 * the global (unscoped) `*transloco` lookup instead, safe because the `characters` scope is
 * already loaded by the time this dialog can open (its only caller loaded it first). */
@Component({
  selector: 'app-note-delete-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="note-delete-confirm__title">
        {{ t('characters.sheet.notes.deleteConfirm.title') }}
      </h2>
      <p class="note-delete-confirm__body">{{ t('characters.sheet.notes.deleteConfirm.body') }}</p>
      <div class="note-delete-confirm__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="cancel()">
          {{ t('characters.sheet.notes.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'danger'" (click)="confirm()">
          {{ t('characters.sheet.notes.deleteConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class NoteDeleteConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/** Same "own root injector, own `DialogService.open()` call, `true`/`false` close result"
 * pattern as `NoteDeleteConfirmComponent` above — task-5-brief.md's inventory remove confirm. */
@Component({
  selector: 'app-item-remove-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="item-remove-confirm__title">
        {{ t('characters.sheet.inventory.deleteConfirm.title') }}
      </h2>
      <p class="item-remove-confirm__body">
        {{ t('characters.sheet.inventory.deleteConfirm.body') }}
      </p>
      <div class="item-remove-confirm__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="cancel()">
          {{ t('characters.sheet.inventory.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'danger'" (click)="confirm()">
          {{ t('characters.sheet.inventory.deleteConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class ItemRemoveConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

// task-3-brief.md extends this set: `propose.spendSlot`/`propose.cast` (`packages/engine/src/
// propose/casting.ts`) are the first play-tab proposers that DO throw — both refuse with
// `'slot.none-left'` when the target level has no slots left. task-5-brief.md adds `'attune.max'`
// — `propose.attune`'s own refusal once `sheet.attunementMax` attuned items are already attuned.
// Every other refusal (should a future engine change ever add one this play tab doesn't yet know
// about) still falls back to `validation.generic` via `diagnosticKey`.
const KNOWN_PROPOSE_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'slot.none-left',
  'attune.max',
]);

// task-5-brief.md: only these item categories ever get an equip toggle in the inventory section —
// same `EQUIPPABLE_CATEGORIES` set `EquipmentStepComponent` (plan 5, task-8-brief.md) uses for its
// own inventory rows, duplicated locally rather than shared (neither file imports the other's
// internals — same "small, per-consumer constant" precedent as this file's own
// `KNOWN_PROPOSE_DIAGNOSTIC_CODES`).
const EQUIPPABLE_CATEGORIES: ReadonlySet<string> = new Set(['weapon', 'armor', 'shield']);

type Denomination = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
const DENOMINATIONS: readonly Denomination[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

// `@hk/engine`'s barrel doesn't re-export `derive/*.ts`'s per-field row types directly (only
// `Sheet` itself — see `derive/index.ts`) — recovered as indexed-access aliases off `Sheet`, same
// trick `create-wizard.component.ts` uses for `Sheet['inventory'][number]`.
type AbilityBlock = Sheet['abilities'][string];
type AttackRow = Sheet['attacks'][number];
type SpellcastingBlock = Sheet['spellcasting'][number];
type ResourceView = Sheet['resources'][number];
type ActionView = Sheet['actions'][number];
type InventoryRow = Sheet['inventory'][number];

interface AbilityRow {
  readonly id: string;
  readonly label: string;
  readonly score: DerivedValue;
  readonly mod: number;
  readonly save: DerivedValue;
  readonly saveProficient: boolean;
}

// `system.skills[].id` values ('none' | 'proficient' | 'expertise' | 'half' — `proficiency.ts`)
// double as this i18n key suffix set; 'none' renders no badge at all (see the template).
type SkillProficiency = 'none' | 'proficient' | 'expertise' | 'half';

interface SkillRow {
  readonly id: string;
  readonly label: string;
  readonly total: DerivedValue;
  readonly proficiency: SkillProficiency;
}

// A known/prepared spellId resolved against the content index (task-3-brief.md): `level`/
// `concentration` come straight off the spell ENTITY (never inferred in UI logic beyond reading
// it — R9) — `0`/`false` when the id doesn't resolve to a `spell` entity (a stale/unknown id;
// `name` still falls back through `resolveName`, same defensive convention as everywhere else).
interface SpellRow {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly concentration: boolean;
}

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

// A dice-notation modifier TERM (task-7-brief.md's roll specs, `parseRollSpec`,
// `packages/engine/src/dice/parse.ts`): `0` omits the term entirely (`'1d20'` alone is valid dice
// notation — a redundant `+0` isn't needed and `parseRollSpec` would reject a bare `-0`-shaped
// oddity anyway), a positive value needs an explicit `+` (dice notation, unlike `signed` above,
// has no default sign to omit), and a negative value already carries its own `-`.
const modifierTerm = (n: number): string => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

type D20RollKind = 'check' | 'save' | 'skill' | 'attackToHit' | 'spellAttack';

// The scoped `t()` shape every roll handler below accepts (same "caller passes its own template-
// scoped `t()`" convention `AbilityScoresStepComponent.onRollAll` documents — `LiveAnnouncer`
// needs the resolved STRING right now, which only a scoped `t()` call, not a raw key, both
// resolves correctly and stays visible to the i18n key checker).
type ScopedT = (key: string, params?: Record<string, unknown>) => string;

/**
 * `/c/:id/play` — the read-only Play tab (plan-5 task-10-brief.md). Every number comes straight off
 * `CharacterStore.sheet()`; nothing here recomputes anything the engine already derived. Inputs
 * (spending resources, rolling dice, editing HP, …) land in plan 6 — this task only renders.
 *
 * `hk-stat-tile`'s `labelKey` is documented as "a full Transloco key" (its own SKILL.md +
 * `sheet-section.component.html`'s matching `*transloco="let t"` with no `read:` scope) — correct
 * for the fixed sheet vocabulary (AC, Initiative, HP, …) but NOT for pack-localized text (ability/
 * skill/spell/item names, which must flow through `EngineFacade.localizer()` instead, per the
 * i18n-is-structural rule). So `hk-stat-tile` is used only for the former; ability rows, skills,
 * attacks, spellcasting, resources, actions, proficiencies/senses/languages and inventory all
 * render their pack-derived names as plain (already-localized) text instead.
 */
@Component({
  selector: 'app-play-tab',
  imports: [
    TranslocoDirective,
    FormsModule,
    ButtonComponent,
    CardComponent,
    ChipComponent,
    HpBarComponent,
    NumberFieldComponent,
    PipsComponent,
    SheetSectionComponent,
    StatTileComponent,
    DerivedPopoverDirective,
    RollLogPanelComponent,
  ],
  // `AddItemDialogComponent`/`CustomItemDialogComponent`/`ItemRemoveConfirmComponent` (task-5-
  // brief.md) never appear in `imports` above — same "opened only via `DialogService.open()`,
  // never placed in this template" convention every other play-tab dialog already follows
  // (`CastDialogComponent`, `ConditionDialogComponent`, `NoteDialogComponent`,
  // `NoteDeleteConfirmComponent`).
  providers: [provideTranslocoScope('characters')],
  templateUrl: './play-tab.component.html',
  styleUrl: './play-tab.component.scss',
})
export class PlayTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly markdownService = inject(MarkdownService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly rollLogService = inject(RollLogService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  protected readonly sheet = this.characterStore.sheet;
  protected readonly signed = signed;

  // The roll-log panel's advantage/disadvantage toggle (task-7-brief.md) — a two-way `model()`
  // bound to `RollLogPanelComponent`'s own `advantageMode` (`[(advantageMode)]` in the template):
  // the panel owns the toggle UI, this component owns reading the CURRENT mode when a d20 roll
  // fires and resetting it back to `'normal'` right after (see `performD20Roll`) — "applies to the
  // NEXT roll" is a one-shot consumption, not a sticky setting.
  protected readonly advantageMode = signal<AdvantageMode>('normal');

  // `HpResult.deathSaves` (`derive/hp.ts`) carries only the two running counts, no "max" — but
  // the cap itself IS engine data (`reduce/facts.ts`'s `DEATH_SAVE_MAX`, a doc-02
  // ENGINE-CONTRACT rule the reducer already enforces in `handlers/vitals.ts`), so it's imported
  // here rather than re-declared — single-sourced, never a second copy of the same rule.
  protected readonly maxDeathSaves = DEATH_SAVE_MAX;

  protected readonly expandedActionId = signal<string | undefined>(undefined);

  // Shared draft amount for the HP damage/heal/temp-HP input group (task-2-brief.md): `null`
  // between submits, same "no ReactiveFormsModule, a plain signal + [ngModel]/(ngModelChange)"
  // convention `sheet-shell.component.ts`'s own `xpAward` uses. One field feeds all three buttons
  // — each reads it at click time and clears it back to `null` only once its own proposal is
  // actually accepted (a refusal leaves whatever the player typed on screen to fix).
  protected readonly hpAmount = signal<number | null>(null);

  protected readonly abilityRows = computed<AbilityRow[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const ids = ABILITY_ORDER.filter((id) => id in sheet.abilities);
    return ids.map((id) => {
      const block: AbilityBlock = sheet.abilities[id];
      return {
        id,
        label: this.abilityName(id, index, localizer),
        score: block.score,
        mod: block.mod,
        save: block.save,
        saveProficient: block.saveProficient,
      };
    });
  });

  protected readonly skillRows = computed<SkillRow[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return Object.entries(sheet.skills)
      .map(([id, block]) => ({
        id,
        label: this.skillName(id, index, localizer),
        total: block.total,
        proficiency: block.proficiency,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly speedRows = computed<{ mode: string; value: DerivedValue }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return Object.entries(sheet.speed).map(([mode, value]) => ({ mode, value }));
  });

  protected readonly attacks = computed<(AttackRow & { name: string })[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.attacks.map((row) => ({ ...row, name: this.resolveName(row.name) }));
  });

  // task-3-brief.md: `block.slots` (`{level, max, used}[]`) already has exactly what `hk-pips`
  // needs, rendered directly in the template — no per-block row-mapping needed for slots anymore
  // (the old `slotRows`/`dots` decorative-only shape is gone along with the plain dot markup it
  // fed). `known`/`prepared` become resolved `SpellRow[]` instead of bare name strings, so the
  // template can gate cantrip-vs-leveled Cast/Prepare affordances off each spell's own level.
  protected readonly spellBlocks = computed<
    (SpellcastingBlock & { knownSpells: SpellRow[]; preparedSpells: SpellRow[] })[]
  >(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.spellcasting.map((block) => ({
      ...block,
      knownSpells: block.known.map((id) => this.spellRow(id)),
      preparedSpells: block.prepared.map((id) => this.spellRow(id)),
    }));
  });

  // task-3-brief.md: `Sheet.concentration` (added this task, `derive/sheet.ts`) is present only
  // while actually concentrating — `undefined` otherwise. Drives the HP-section chip/End button.
  protected readonly concentration = computed(() => this.sheet()?.concentration);

  protected readonly hitDiceRows = computed<
    {
      classId: string;
      className: string;
      die: number;
      total: number;
      spent: number;
      remaining: number;
    }[]
  >(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return Object.entries(sheet.hp.hitDice).map(([classId, dice]) => ({
      classId,
      className: this.resolveName(classId),
      ...dice,
    }));
  });

  // task-6-brief.md: `RestDialogComponent`'s hit-dice picker only ever offers a class that still
  // has dice left to roll — a class already fully spent has nothing to offer the "roll one at a
  // time" flow. Pre-resolved (`classId`/`className` only, same "resolve before opening" convention
  // `conditionOptions` documents) — `RestDialogComponent` reads `die`/`remaining` itself straight
  // off the `sheet` it's given, never duplicated here.
  protected readonly hitDiceRollOptions = computed<RestDialogHitDieOption[]>(() =>
    this.hitDiceRows()
      .filter((row) => row.remaining > 0)
      .map((row) => ({ classId: row.classId, className: row.className })),
  );

  protected readonly resources = computed<ResourceView[]>(() => this.sheet()?.resources ?? []);

  protected readonly actions = computed<ActionView[]>(() => this.sheet()?.actions ?? []);

  protected readonly conditions = computed<{ id: string; name: string; level?: number }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.conditions.map((c) => ({
      id: c.conditionId,
      name: this.resolveName(c.conditionId),
      level: c.level,
    }));
  });

  // task-4-brief.md: the condition-add dialog's options — `index.system().conditions` (the
  // pack's own entity-id list, never a hardcoded set) resolved to a localized name and a
  // data-driven `levelBearing` flag. `levelBearing` reads `ConditionEntitySchema.levels`
  // (`@hk/protocol`) — present ONLY on the pack's exhaustion entity today, but never assumed to
  // be exhaustion specifically; any future level-bearing condition the pack adds picks this up
  // automatically. Sorted alphabetically by localized name, same convention as `skillRows`.
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

  // `Facts.notes` (`reduce/facts.ts`) — notes are freeform stream state with no derived-`Sheet`
  // projection of their own (`propose.note`'s own header comment: "no `Sheet` input, unlike every
  // other proposer"), so this reads `CharacterStore.facts()` directly rather than `sheet()`.
  protected readonly notes = computed<NoteEntry[]>(() => this.characterStore.facts()?.notes ?? []);

  // The protocol schema's own `NoteAdded.body` cap (`NoteAddedV1.shape.body`'s Zod `.max(8192)`)
  // — resolved via `.unwrap().maxLength` (mirrors `create-wizard.component.ts`'s own
  // `ShortTextSchema.maxLength` convention) so the note dialog's over-limit guard is never a
  // duplicated magic number.
  protected readonly noteBodyMaxLength =
    NoteAddedV1.shape.body.unwrap().maxLength ?? Number.MAX_SAFE_INTEGER;

  protected readonly proficiencyRows = computed<{ kind: string; target: string; level: string }[]>(
    () => {
      const sheet = this.sheet();
      if (!sheet) return [];
      return sheet.proficiencies.map((p) => ({
        kind: p.kind,
        target: this.resolveName(p.target),
        level: p.level,
      }));
    },
  );

  protected readonly senseRows = computed<{ sense: string; range: number }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.senses.map((s) => ({ sense: this.resolveName(s.sense), range: s.range }));
  });

  protected readonly languageRows = computed<string[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.languages.map((l) => this.resolveName(l.id));
  });

  // task-5-brief.md: `row.resolved` (`derive/sheet.ts`) is `false` only for a STALE itemId (one
  // that no longer resolves in the content index) — a custom item's `itemId` is undefined, which
  // `derive/index.ts` deliberately treats as trivially "resolved" (nothing to look up). The
  // inventory section's own "renders by name, unresolved styling" treatment is for BOTH cases —
  // a player-facing custom line and a genuinely broken pack reference look the same (plain name,
  // no pack-backed facts) — so `unresolved` here is the UI's own broader flag, true whenever
  // there's no live pack entity behind the row at all (`!row.itemId || !row.resolved`), not a
  // re-export of the engine's narrower `resolved` field.
  //
  // `weight` (the plan's WEIGHT self-review note, binding for this task): display-only, straight
  // off the resolved item ENTITY's own `weight` (lb, per pack entry) × this row's `qty` — never a
  // per-row encumbrance judgment, just the stack's total weight for the row/section-total display.
  // `undefined` for a custom row or an item entity with no declared weight (nothing rendered).
  protected readonly inventoryRows = computed<
    {
      row: InventoryRow;
      name: string;
      weight?: number;
      unresolved: boolean;
      equipEligible: boolean;
      attuneEligible: boolean;
    }[]
  >(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    return sheet.inventory.map((row) => {
      const entity = row.itemId ? index.get(row.itemId) : undefined;
      const item = entity?.type === 'item' ? entity : undefined;
      return {
        row,
        name: this.itemName(row),
        weight: item?.weight !== undefined ? item.weight * row.qty : undefined,
        unresolved: !row.itemId || !row.resolved,
        equipEligible: item !== undefined && EQUIPPABLE_CATEGORIES.has(item.category),
        // Gated by the resolved item ENTITY's own `attunement.required` (`ItemEntitySchema`,
        // `packages/protocol/src/pack/entities-content.ts`) — never inferred any other way. A
        // custom row (no `itemId`, no entity to read) is never attune-eligible, matching
        // `CustomItemDialogComponent`'s own docstring (ruling 2: name+qty+notes only, no
        // mechanics). `attunement.required === false` (an item WITH attunement data that simply
        // doesn't need it) is also ineligible — only `true` opts a row in.
        attuneEligible: item?.attunement?.required === true,
      };
    });
  });

  // The section header's "simple sum" (WEIGHT self-review note) — no encumbrance thresholds, just
  // the total of every row's own (already qty-multiplied) `weight`.
  protected readonly totalWeight = computed<number>(() =>
    this.inventoryRows().reduce((sum, entry) => sum + (entry.weight ?? 0), 0),
  );

  // Currency editor draft (task-5-brief.md): `null` until the player edits a field, matching the
  // `hpAmount` convention above — `effectiveCurrency` falls back to the live `sheet().currency`
  // whenever there's no in-progress edit, so the five fields always start pre-filled with the
  // CURRENT totals, never zeros. Reset back to `null` only once `onApplyCurrency` reports the
  // proposal was actually accepted (same "a refusal leaves what the player typed on screen"
  // convention `applyHpChange` documents).
  protected readonly currencyDraft = signal<Sheet['currency'] | null>(null);

  protected readonly effectiveCurrency = computed<Sheet['currency']>(
    () => this.currencyDraft() ?? this.sheet()?.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  );

  protected readonly denominations = DENOMINATIONS;

  // Re-renders the currently-expanded action's markdown `description`, reusing `MarkdownService`
  // exactly like `entity-picker.component.ts`'s own `descriptionHtml` resource (task-6-brief.md:
  // "reuse, do not re-implement sanitization").
  protected readonly actionDescriptionHtml = resource({
    params: () => this.expandedActionId(),
    loader: ({ params }): Promise<SafeHtml | undefined> => {
      const action = this.actions().find((a) => a.id === params);
      return action?.description
        ? this.markdownService.render(action.description)
        : Promise.resolve(undefined);
    },
  });

  protected toggleAction(id: string): void {
    this.expandedActionId.update((current) => (current === id ? undefined : id));
  }

  protected isActionExpanded(id: string): boolean {
    return this.expandedActionId() === id;
  }

  // --- HP, death saves, inspiration (task-2-brief.md) -----------------------------------------

  protected onHpAmountChange(value: number | null): void {
    this.hpAmount.set(value);
  }

  protected onDamage(): void {
    this.applyHpChange((sheet, amount) => propose.damage(sheet, amount));
  }

  protected onHeal(): void {
    this.applyHpChange((sheet, amount) => propose.heal(sheet, amount));
  }

  protected onAddTemp(): void {
    this.applyHpChange((sheet, amount) => propose.tempHp(sheet, amount));
  }

  protected onDeathSave(result: DeathSaveResult): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.deathSave(sheet, result));
  }

  protected onToggleInspiration(): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.inspiration(sheet, !sheet.inspiration));
  }

  // Damage/heal/temp-HP share one draft amount field and one "no-op below 1" guard (typing 0 or
  // leaving it empty just does nothing — no error, nothing to refuse); the amount is cleared back
  // to `null` only when `tryPropose` reports the proposal was actually accepted, so a refused one
  // leaves the typed amount on screen to fix and resubmit.
  private applyHpChange(build: (sheet: Sheet, amount: number) => ProposedEvent[]): void {
    const sheet = this.sheet();
    const amount = this.hpAmount();
    if (!sheet || amount === null || amount < 1) return;
    if (this.tryPropose(() => build(sheet, amount))) {
      this.hpAmount.set(null);
    }
  }

  // Every `propose.*` call in this component funnels through here (task-2-brief.md's "ProposeError
  // -> toast" contract): building the drafts is synchronous, so a `ProposeError` a proposer throws
  // is caught right here, never inside `appendTx`'s own (async, unrelated — leadership/storage)
  // error path. The toast key reuses `diagnosticKey` — the same scope-relative mapping the
  // create-wizard's `choice-step.component.ts` uses for its own inline diagnostics — prefixed with
  // this app's `'characters.'` Transloco scope, since `ToastService.show` resolves global keys.
  // `appendTx` itself is fire-and-forget (mirrors `sheet-shell.component.ts`'s own `xpAward`
  // submit — leadership/storage failures aren't this task's concern). Returns whether the
  // proposal was accepted, so callers that need to reset UI state only do so on success.
  private tryPropose(build: () => ProposedEvent[]): boolean {
    try {
      void this.characterStore.appendTx(build());
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

  // Falls back to the raw id/slug for anything the content index doesn't resolve (a proficiency
  // target like the weapon-category slug 'martial', or a stale/unknown reference) — never throws.
  // `protected`, not `private`: also called directly from the template (an action's `resource`).
  protected resolveName(id: string): string {
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
  }

  // task-1-brief.md carry fix (plan-5 owner-flag "ActionView/ResourceView English names"):
  // `ResourceView.name`/`ActionView.name` (`derive/resources.ts`/`derive/actions.ts`) are baked at
  // build time straight off the granting feature's `resource.define`/`action.define` effect — a
  // fixed ENGLISH string, never routed through the Localizer. `.source` (`ae.feature ?? ae.source`)
  // is the entity id that effect came from, and IS resolvable through `Localizer.name` — prefer it,
  // same "resolve through the index, fall back to the raw/baked value" convention as `resolveName`.
  protected resourceLabel(view: ResourceView): string {
    const index = this.engineFacade.index();
    return index.has(view.source) ? this.engineFacade.localizer().name(view.source) : view.name;
  }

  protected actionLabel(view: ActionView): string {
    const index = this.engineFacade.index();
    return index.has(view.source) ? this.engineFacade.localizer().name(view.source) : view.name;
  }

  // Scope-RELATIVE key (no 'characters.' prefix) — the template resolves it through its own
  // scoped `t()` (`*transloco="let t; read: 'characters'"`), which already prepends the scope
  // itself; a full key here would double-prefix and silently miss (the scoped-`t()` bug
  // precedent this codebase has hit twice before). 'none' has no badge to show at all (the
  // template gates on it) — this only ever needs to resolve the other three.
  protected skillProficiencyLabelKey(level: SkillProficiency): string {
    return `sheet.skills.proficiencyLevel.${level}`;
  }

  // Mirrors `create-wizard.component.ts`'s own `abilityLabel`/`itemName` fallback convention
  // (resolve by ability abbreviation against the pack's own `ability` entities; raw key uppercased
  // when the pack has none).
  private abilityName(key: string, index: ContentIndex, localizer: Localizer): string {
    const entity = index
      .byType('ability')
      .find((e) => e.type === 'ability' && e.abbreviation === key);
    return entity ? localizer.name(entity.id) : key.toUpperCase();
  }

  // `system.skills[].id` is a plain slug (e.g. 'athletics'), not itself an entity id — the SRD pack
  // separately declares a `skill` entity per slug under the system's own pack id (mirrors
  // `create-wizard.component.ts`'s `formatSelectionParts` skills-suffix branch).
  private skillName(slug: string, index: ContentIndex, localizer: Localizer): string {
    const packId = parseEntityId(index.system().id)?.packId;
    const skillId = packId ? makeEntityId(packId, 'skill', slug) : undefined;
    return skillId && index.has(skillId) ? localizer.name(skillId) : slug;
  }

  private itemName(entry: InventoryRow): string {
    return entry.itemId ? this.resolveName(entry.itemId) : (entry.name ?? entry.instanceId);
  }

  // --- Rest (task-6-brief.md) -------------------------------------------------------------------

  // CANONICAL REST FLOW (binding, Global Constraints — plan-4 carry, `CharacterStore`'s own class
  // doc, `propose/rest.ts`'s header comment, `RestDialogComponent`'s own class doc): hit-dice
  // healing is collected INSIDE `RestDialogComponent` itself, one `propose.spendHitDie` draft per
  // die the player rolls (that dialog is the one play-tab dialog allowed to call a `propose.*`
  // function directly — see its class doc for why). This handler's only job is to concatenate
  // those collected drafts with `propose.rest(sheet, 'short')` into ONE `appendTx` call, so the
  // whole rest — every hit die spent plus the rest itself — shares a single `txId` in the
  // timeline. Re-reads `this.sheet()` AFTER the dialog closes for the FINAL `propose.rest` call
  // (same "never a stale pre-dialog snapshot" convention `onCastLeveled` documents) — the already-
  // collected hit-die drafts stay valid regardless, since each is already a fully-formed, self-
  // contained payload that doesn't depend on when it's appended.
  protected async onShortRest(): Promise<void> {
    const openSheet = this.sheet();
    if (!openSheet) return;
    const handle = this.dialogService.open(RestDialogComponent, {
      data: {
        kind: 'short',
        sheet: openSheet,
        hitDiceOptions: this.hitDiceRollOptions(),
      } satisfies RestDialogData,
    });
    const result = (await handle.closed) as RestDialogResult | undefined;
    if (result?.kind !== 'short') return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => [...result.drafts, ...propose.rest(sheet, 'short')]);
  }

  // A long rest never spends hit dice one at a time (5e regains them automatically — the
  // reducer's own `rest.taken@1` handler, `handlers/casting.ts`), so this is just a confirm dialog
  // followed by a single `propose.rest(sheet, 'long')` call — no drafts to concatenate.
  protected async onLongRest(): Promise<void> {
    const openSheet = this.sheet();
    if (!openSheet) return;
    const handle = this.dialogService.open(RestDialogComponent, {
      data: { kind: 'long', sheet: openSheet, hitDiceOptions: [] } satisfies RestDialogData,
    });
    const result = (await handle.closed) as RestDialogResult | undefined;
    if (result?.kind !== 'long') return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.rest(sheet, 'long'));
  }

  // --- Slots, resources, prepare/cast, concentration (task-3-brief.md) ------------------------

  // Every hand-assembled event this task appends goes through here — `DraftEvent`s never throw
  // (unlike `propose.*`, there's no engine-side refusal to catch), so this is a plain fire-and-
  // forget `appendTx`, same "leadership/storage failures aren't this task's concern" convention
  // `tryPropose` documents for the propose side.
  private appendDraft(drafts: DraftEvent[]): void {
    void this.characterStore.appendTx(drafts);
  }

  protected onSpendSlot(level: number): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.spendSlot(sheet, level));
  }

  // `slot.restored` with no `count` defaults to a SINGLE-slot decrement (`handlers/casting.ts`) —
  // exactly one pip's worth, matching `hk-pips`' own "one click, one unit" contract.
  protected onRestoreSlot(level: number): void {
    this.appendDraft([{ type: 'slot.restored', v: 1, payload: { level } satisfies SlotRestored }]);
  }

  protected onSpendResource(resourceId: string): void {
    this.appendDraft([
      { type: 'resource.spent', v: 1, payload: { resourceId } satisfies ResourceSpent },
    ]);
  }

  // Deliberate divergence from `resource.restored`'s own OMITTED-count default: that form is a
  // FULL reset to 0 used (`handlers/casting.ts`'s own comment — it's `propose.rest`'s shape, one
  // `resource.restored{resourceId}` per reset resource on a rest), not "subtract one". A single
  // pip click restoring the WHOLE resource regardless of how many uses remain would be a
  // surprising, data-lossy default for a "one click, one unit" control, so this passes an
  // explicit `count: 1` — symmetric with `slot.restored`'s own default (which DOES already mean a
  // single-unit decrement) and with what clicking exactly one pip visually promises.
  protected onRestoreResource(resourceId: string): void {
    this.appendDraft([
      {
        type: 'resource.restored',
        v: 1,
        payload: { resourceId, count: 1 } satisfies ResourceRestored,
      },
    ]);
  }

  protected isSpellPrepared(block: SpellcastingBlock, spellId: string): boolean {
    return block.prepared.includes(spellId);
  }

  // Prepared-cap enforcement: the ENGINE applies no cap on `spell.prepared` at all — its handler
  // (`handlers/casting.ts`) just appends to the list unconditionally. `preparedMax`
  // (`derive/spellcasting.ts`) is READ-MODEL only, so this UI is the only place the cap can ever
  // be enforced; a blocked attempt gets a toast, never a silently-dropped/ignored click.
  protected onTogglePrepared(block: SpellcastingBlock, spellId: string): void {
    if (this.isSpellPrepared(block, spellId)) {
      this.appendDraft([
        {
          type: 'spell.unprepared',
          v: 1,
          payload: { spellId, classId: block.classId } satisfies SpellUnprepared,
        },
      ]);
      return;
    }
    if (block.preparedMax !== undefined && block.prepared.length >= block.preparedMax) {
      this.toastService.show('characters.sheet.spellcasting.preparedMaxReached', {
        max: block.preparedMax,
      });
      return;
    }
    this.appendDraft([
      {
        type: 'spell.prepared',
        v: 1,
        payload: { spellId, classId: block.classId } satisfies SpellPrepared,
      },
    ]);
  }

  // R-pf3 (controller ruling, binding): a cantrip casts DIRECTLY from its own button, no dialog —
  // `level: 0, useSlot: false` (cantrips have no slot-table entry at all), `concentration` read
  // straight off the spell entity (`SpellRow.concentration`, resolved via `spellRow` below).
  protected onCastCantrip(spellId: string, concentration: boolean): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.cast(sheet, spellId, { level: 0, useSlot: false, concentration }),
    );
  }

  // Opens `CastDialogComponent` for a slot-level pick (task-3-brief.md): `availableSlots` is
  // filtered here (never inside the dialog) to slots at/above the spell's own level with room
  // left. Re-reads `this.sheet()` AFTER the dialog closes (never the `sheet` captured before
  // `await`) — the store may have advanced meanwhile (another action, another tab), and
  // `propose.cast` must validate against the CURRENT sheet, not a stale snapshot; a slot spent
  // out from under a still-open dialog surfaces as a genuine `'slot.none-left'` `ProposeError`,
  // caught by `tryPropose` exactly like any other refusal.
  protected async onCastLeveled(block: SpellcastingBlock, row: SpellRow): Promise<void> {
    const availableSlots = block.slots.filter((s) => s.level >= row.level && s.used < s.max);
    const handle = this.dialogService.open(CastDialogComponent, {
      data: {
        spellName: row.name,
        spellLevel: row.level,
        spellConcentration: row.concentration,
        availableSlots,
        alreadyConcentrating: this.concentration() !== undefined,
      } satisfies CastDialogData,
    });
    const chosenLevel = await handle.closed;
    if (typeof chosenLevel !== 'number') return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.cast(sheet, row.id, { level: chosenLevel, concentration: row.concentration }),
    );
  }

  protected onEndConcentration(): void {
    this.appendDraft([
      { type: 'concentration.ended', v: 1, payload: {} satisfies ConcentrationEnded },
    ]);
  }

  // --- Conditions, exhaustion, notes (task-4-brief.md) ------------------------------------------

  // Opens `ConditionDialogComponent` with the pre-resolved option list (never built inside the
  // dialog — same "resolve before opening" convention `onCastLeveled` uses for `availableSlots`).
  // `propose.condition` never throws (it has no refusal path — `packages/engine/src/propose/
  // vitals.ts`), so this still funnels through `tryPropose` only for its shared appendTx wiring,
  // not because a `ProposeError` is expected here.
  protected async onAddCondition(): Promise<void> {
    const options = this.conditionOptions();
    if (options.length === 0) return;
    const handle = this.dialogService.open(ConditionDialogComponent, {
      data: { options } satisfies ConditionDialogData,
    });
    const result = (await handle.closed) as ConditionDialogResult | undefined;
    if (!result) return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.condition(sheet, result.conditionId, true, result.level));
  }

  protected onRemoveCondition(conditionId: string): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.condition(sheet, conditionId, false));
  }

  // `propose.note` takes no `Sheet` (its own header comment) — every note action below fires
  // straight through `appendDraft`, same fire-and-forget convention as every other hand-assembled
  // draft in this component (no `ProposeError` this proposer could ever throw).
  protected async onAddNote(): Promise<void> {
    const handle = this.dialogService.open(NoteDialogComponent, {
      data: { mode: 'add', maxBodyLength: this.noteBodyMaxLength } satisfies NoteDialogData,
    });
    const result = (await handle.closed) as NoteDialogResult | undefined;
    if (!result) return;
    this.appendDraft(
      propose.note('added', { id: uuidv7(), title: result.title, body: result.body }),
    );
  }

  protected async onEditNote(note: NoteEntry): Promise<void> {
    const handle = this.dialogService.open(NoteDialogComponent, {
      data: {
        mode: 'edit',
        title: note.title || undefined,
        body: note.body || undefined,
        maxBodyLength: this.noteBodyMaxLength,
      } satisfies NoteDialogData,
    });
    const result = (await handle.closed) as NoteDialogResult | undefined;
    if (!result) return;
    this.appendDraft(
      propose.note('updated', { id: note.id, title: result.title, body: result.body }),
    );
  }

  protected async onRemoveNote(note: NoteEntry): Promise<void> {
    const handle = this.dialogService.open(NoteDeleteConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    this.appendDraft(propose.note('removed', { id: note.id }));
  }

  // --- Inventory and currency (task-5-brief.md) -------------------------------------------------

  protected async onAddFromLibrary(): Promise<void> {
    const handle = this.dialogService.open(AddItemDialogComponent, { sheet: true });
    const result = (await handle.closed) as AddItemDialogResult | undefined;
    if (!result) return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() =>
      propose.addItem(sheet, { itemId: result.itemId, qty: result.qty }, uuidv7),
    );
  }

  // Ruling 2 (binding): a custom item's `item.added` draft carries `custom: {}` and NO `itemId`
  // — the marker the reducer/derive side already treat as "fully custom, nothing to resolve"
  // (`derive/index.ts`'s own `resolved = item.itemId === undefined || index.has(item.itemId)`).
  // `notes` isn't part of `ItemAdded` at all (only `ItemUpdatedV1` has it), so a non-blank notes
  // field becomes a SECOND, hand-assembled `item.updated {instanceId, notes}` draft sharing the
  // SAME freshly-minted `instanceId` — both concatenated into one `tryPropose` call so
  // `CharacterStore.appendTx` gives them one shared `txId` (Global Constraints: "CONCAT related
  // proposals into ONE appendTx call").
  protected async onAddCustomItem(): Promise<void> {
    const handle = this.dialogService.open(CustomItemDialogComponent);
    const result = (await handle.closed) as CustomItemDialogResult | undefined;
    if (!result) return;
    const sheet = this.sheet();
    if (!sheet) return;
    const instanceId = uuidv7();
    this.tryPropose(() => {
      const drafts = propose.addItem(
        sheet,
        { name: result.name, qty: result.qty, custom: {} },
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

  protected onToggleEquip(row: InventoryRow): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.equip(sheet, row.instanceId, !row.equipped));
  }

  // `propose.attune` is the first `propose.*` in this component whose refusal (`'attune.max'`,
  // once `sheet.attunementMax` items are already attuned) this task adds to
  // `KNOWN_PROPOSE_DIAGNOSTIC_CODES` — it funnels through the same `tryPropose` -> toast wiring as
  // every other proposer, no special handling needed here.
  protected onToggleAttune(row: InventoryRow): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.tryPropose(() => propose.attune(sheet, row.instanceId, !row.attuned));
  }

  // `item.updated{qty}` REPLACES the stored qty (never a delta — `handlers/inventory.ts`'s own
  // merge-only-provided-fields idiom), so both directions send the already-computed new total.
  // The decrement button is disabled in the template once `qty` hits `ItemAddedV1.qty`'s own
  // floor of 1 (removing a stack down to 0 is the Remove button's job, not the stepper's).
  protected onIncreaseQty(row: InventoryRow): void {
    this.appendDraft([
      {
        type: 'item.updated',
        v: 1,
        payload: { instanceId: row.instanceId, qty: row.qty + 1 } satisfies ItemUpdated,
      },
    ]);
  }

  protected onDecreaseQty(row: InventoryRow): void {
    if (row.qty <= 1) return;
    this.appendDraft([
      {
        type: 'item.updated',
        v: 1,
        payload: { instanceId: row.instanceId, qty: row.qty - 1 } satisfies ItemUpdated,
      },
    ]);
  }

  // Behind its own confirm dialog (`ItemRemoveConfirmComponent`, above) — same "revert-confirm"
  // pattern `onRemoveNote` uses. No `qty` in the draft: `handlers/inventory.ts`'s `item.removed@1`
  // treats a missing `qty` as "remove the whole entry", never a partial decrement.
  protected async onRemoveItem(row: InventoryRow): Promise<void> {
    const handle = this.dialogService.open(ItemRemoveConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    this.appendDraft([
      { type: 'item.removed', v: 1, payload: { instanceId: row.instanceId } satisfies ItemRemoved },
    ]);
  }

  protected onCurrencyFieldChange(denom: Denomination, value: number | null): void {
    this.currencyDraft.set({ ...this.effectiveCurrency(), [denom]: value ?? 0 });
  }

  // `propose.currency` takes DELTAS, not totals (task-5-brief.md) — computed here as `draft -
  // current` per denomination, straight off the live `sheet().currency` at apply time (never a
  // snapshot taken when the field was first edited, in case another action changed the currency
  // meanwhile). A denomination the player never touched (or typed back to its original value)
  // nets to a zero delta and is left OUT of the payload entirely — `CurrencyChangedV1`'s fields
  // are all optional, and an explicit `0` would be indistinguishable from "no change" to the
  // reducer anyway, so omitting it keeps the emitted event minimal. Negative deltas are allowed
  // through as-is; the reducer floors each denomination at 0 independently
  // (`handlers/inventory.ts`).
  protected onApplyCurrency(): void {
    const sheet = this.sheet();
    if (!sheet) return;
    const draft = this.effectiveCurrency();
    const deltas: Partial<Sheet['currency']> = {};
    for (const denom of DENOMINATIONS) {
      const delta = draft[denom] - sheet.currency[denom];
      if (delta !== 0) deltas[denom] = delta;
    }
    if (Object.keys(deltas).length === 0) return;
    if (this.tryPropose(() => propose.currency(sheet, deltas))) {
      this.currencyDraft.set(null);
    }
  }

  // Resolves a known/prepared spellId (task-3-brief.md): `level`/`concentration` read straight off
  // the spell ENTITY via the content index (R9 — never inferred any other way); falls back to
  // `0`/`false` for a stale/unresolved id, same defensive convention as `resolveName`.
  private spellRow(id: string): SpellRow {
    const entity = this.engineFacade.index().get(id);
    const spell = entity?.type === 'spell' ? entity : undefined;
    return {
      id,
      name: this.resolveName(id),
      level: spell?.level ?? 0,
      concentration: spell?.concentration ?? false,
    };
  }

  // --- Dice roller (task-7-brief.md) ------------------------------------------------------------

  // Every tap-to-roll affordance below uses the ROW'S ALREADY-DERIVED total as the roll's
  // modifier — never recomputed here (task-7-brief.md: "your tap-to-roll uses the row's already-
  // derived total ... NEVER recomputing"). `1d20` (or, under advantage/disadvantage,
  // `2d20kh1`/`2d20kl1` — the engine's own keep semantics, `packages/engine/src/dice/parse.ts`)
  // plus that modifier is the ENTIRE spec; `roll()`/`cryptoRng` do the actual rolling.
  private performD20Roll(
    kind: D20RollKind,
    params: Record<string, unknown>,
    modifier: number,
    t: ScopedT,
  ): void {
    const mode = this.advantageMode();
    const diceTerm = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
    const spec = parseRollSpec(`${diceTerm}${modifierTerm(modifier)}`);
    const result = roll(spec, cryptoRng);

    this.rollLogService.add({
      labelKey: `sheet.roll.entries.${kind}`,
      params,
      dice: result.dice,
      modifier,
      total: result.total,
      ...(mode !== 'normal' ? { advantage: mode } : {}),
    });
    // One-shot: advantage/disadvantage applies to exactly the roll that just consumed it (task-7-
    // brief.md: "applies to the NEXT d20 roll"), then the panel's toggle group reflects Normal
    // again via this same two-way-bound signal.
    this.advantageMode.set('normal');
    void this.liveAnnouncer.announce(
      t(`sheet.roll.announce.${kind}`, { ...params, total: result.total }),
    );
  }

  protected onRollAbilityCheck(row: AbilityRow, t: ScopedT): void {
    this.performD20Roll('check', { name: row.label }, row.mod, t);
  }

  protected onRollAbilitySave(row: AbilityRow, t: ScopedT): void {
    this.performD20Roll('save', { name: row.label }, row.save.value, t);
  }

  protected onRollSkill(skillRow: SkillRow, t: ScopedT): void {
    this.performD20Roll('skill', { name: skillRow.label }, skillRow.total.value, t);
  }

  protected onRollAttackToHit(attack: AttackRow & { name: string }, t: ScopedT): void {
    this.performD20Roll('attackToHit', { name: attack.name }, attack.toHit.value, t);
  }

  protected onRollSpellAttack(block: SpellcastingBlock, t: ScopedT): void {
    this.performD20Roll(
      'spellAttack',
      { name: this.resolveName(block.classId) },
      block.attack.value,
      t,
    );
  }

  // Damage never takes advantage/disadvantage (a d20-only mechanic) and its dice come straight
  // from the row's OWN dice string (task-7-brief.md: "attack damage rolls parse the row's dice
  // string via parseRollSpec + bonus") — `attack.damage.dice` is pure dice notation (no baked-in
  // modifier), so the bonus is added programmatically to the parsed roll's own total rather than
  // string-concatenated into the spec.
  protected onRollAttackDamage(attack: AttackRow & { name: string }, t: ScopedT): void {
    const spec = parseRollSpec(attack.damage.dice);
    const result = roll(spec, cryptoRng);
    const bonus = attack.damage.bonus.value;
    const total = result.total + bonus;

    this.rollLogService.add({
      labelKey: 'sheet.roll.entries.attackDamage',
      params: { name: attack.name },
      dice: result.dice,
      modifier: bonus,
      total,
    });
    void this.liveAnnouncer.announce(
      t('sheet.roll.announce.attackDamage', { name: attack.name, total }),
    );
  }
}
