import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SafeHtml } from '@angular/platform-browser';
import {
  DEATH_SAVE_MAX,
  propose,
  ProposeError,
  type ContentIndex,
  type Localizer,
  type ProposedEvent,
  type Sheet,
} from '@hk/engine';
import {
  makeEntityId,
  parseEntityId,
  type ConcentrationEnded,
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
import { DialogService } from '@shared/components/dialog/dialog.service';
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
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterStore, type DraftEvent } from '@shared/stores/character.store';
import { CastDialogComponent, type CastDialogData } from './cast-dialog.component';

type DeathSaveResult = 'success' | 'failure' | 'critSuccess' | 'critFailure';

// task-3-brief.md extends this set: `propose.spendSlot`/`propose.cast` (`packages/engine/src/
// propose/casting.ts`) are the first play-tab proposers that DO throw — both refuse with
// `'slot.none-left'` when the target level has no slots left. Every other refusal (should a
// future engine change ever add one this play tab doesn't yet know about) still falls back to
// `validation.generic` via `diagnosticKey`.
const KNOWN_PROPOSE_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set(['slot.none-left']);

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
  ],
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

  protected readonly sheet = this.characterStore.sheet;
  protected readonly signed = signed;

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

  protected readonly inventoryRows = computed<{ row: InventoryRow; name: string }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.inventory.map((row) => ({ row, name: this.itemName(row) }));
  });

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
}
