import { Component, computed, inject, resource, signal } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';
import { DEATH_SAVE_MAX, type ContentIndex, type Localizer, type Sheet } from '@hk/engine';
import { makeEntityId, parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { StatTileComponent } from '@shared/components/stat-tile/stat-tile.component';
import {
  DerivedPopoverDirective,
  type DerivedValue,
} from '@shared/directives/derived-popover.directive';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterStore } from '@shared/stores/character.store';

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

interface SlotRow {
  readonly level: number;
  readonly max: number;
  readonly used: number;
  readonly dots: readonly boolean[]; // true = filled/used
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
    CardComponent,
    ChipComponent,
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

  protected readonly sheet = this.characterStore.sheet;
  protected readonly signed = signed;

  // `HpResult.deathSaves` (`derive/hp.ts`) carries only the two running counts, no "max" — but
  // the cap itself IS engine data (`reduce/facts.ts`'s `DEATH_SAVE_MAX`, a doc-02
  // ENGINE-CONTRACT rule the reducer already enforces in `handlers/vitals.ts`), so it's imported
  // here rather than re-declared — single-sourced, never a second copy of the same rule.
  protected readonly maxDeathSaves = DEATH_SAVE_MAX;

  protected readonly expandedActionId = signal<string | undefined>(undefined);

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

  protected readonly spellBlocks = computed<
    (SpellcastingBlock & { slotRows: SlotRow[]; knownNames: string[]; preparedNames: string[] })[]
  >(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.spellcasting.map((block) => ({
      ...block,
      slotRows: block.slots.map((slot) => ({
        ...slot,
        dots: Array.from({ length: slot.max }, (_, i) => i < slot.used),
      })),
      knownNames: block.known.map((id) => this.resolveName(id)),
      preparedNames: block.prepared.map((id) => this.resolveName(id)),
    }));
  });

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

  // Falls back to the raw id/slug for anything the content index doesn't resolve (a proficiency
  // target like the weapon-category slug 'martial', or a stale/unknown reference) — never throws.
  // `protected`, not `private`: also called directly from the template (an action's `resource`).
  protected resolveName(id: string): string {
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
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
}
