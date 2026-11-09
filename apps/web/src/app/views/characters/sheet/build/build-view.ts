import {
  classSkillPick,
  findChoice,
  type ContentIndex,
  type Facts,
  type Localizer,
  type Sheet,
} from '@hk/engine';
import { parseChoiceId } from '@hk/protocol';
import type { SheetNames } from '../play/play-names';

/*
 * The Build tab's read model (board B01): plain functions from the live facts, the derived sheet and
 * the content index to what each section draws. Nothing here encodes a rule: every name, number and
 * restriction is read from pack data or the sheet; the only decisions made are presentation ones
 * (which row gets a lock chip, in what order rows are listed).
 */

/** What the view functions read. `names` resolves ids/slugs through the pack text. */
export interface BuildSource {
  readonly facts: Facts;
  readonly sheet: Sheet;
  readonly index: ContentIndex;
  readonly localizer: Localizer;
  readonly names: SheetNames;
}

/** A lock chip: a short label and the reason, which is shown as a hint (tooltip + aria), never inline. */
export interface LockView {
  readonly kind: 'fixed' | 'viaLevelUp' | 'subclass' | 'granted' | 'unsupported';
  readonly params?: Record<string, string | number>;
}

export interface OriginRow {
  readonly key: 'species' | 'class' | 'subclass' | 'background' | 'originFeat';
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  /** i18n key (relative to `sheet.build.origin`) and params of the grey detail line. */
  readonly detail: { readonly key: string; readonly params: Record<string, string | number> };
  readonly empty?: boolean;
  readonly lock?: LockView;
}

const slugOf = (entityId: string): string => entityId.slice(entityId.lastIndexOf('/') + 1);

/** The entity id decided for one creation composition slot of the system (species, background). */
function slotPick(src: BuildSource, entityType: string): string | undefined {
  const system = src.index.system();
  const slot = system.compositionSlots.find(
    (s) => s.at === 'creation' && s.entityType === entityType,
  );
  if (!slot) return undefined;
  return src.facts.decisions[`${system.id}@0/${slot.id}`]?.[0];
}

const CLASS_ICONS: ReadonlySet<string> = new Set([
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
]);

export function originRows(src: BuildSource): OriginRow[] {
  const { index, localizer, names } = src;
  const rows: OriginRow[] = [];

  const speciesId = slotPick(src, 'species');
  const species = speciesId ? index.get(speciesId) : undefined;
  if (speciesId) {
    rows.push({
      key: 'species',
      id: speciesId,
      icon: 'ui:heroes',
      name: species ? localizer.name(speciesId) : speciesId,
      detail: {
        key: 'speciesDetail',
        params: { speed: species?.type === 'species' ? species.speed : 0 },
      },
      lock: { kind: 'fixed' },
    });
  }

  for (const entry of src.facts.classes) {
    const classId = index.resolveClassRef(entry.classId) ?? entry.classId;
    const entity = index.get(classId);
    const cls = entity?.type === 'class' ? entity : undefined;
    const className = cls ? localizer.name(classId) : entry.classId;
    rows.push({
      key: 'class',
      id: classId,
      icon: CLASS_ICONS.has(slugOf(classId)) ? `ui:class-${slugOf(classId)}` : 'ui:build',
      name: `${className} ${entry.level}`,
      detail: {
        key: 'classDetail',
        params: {
          die: cls?.hitDie ?? 0,
          saves: (cls?.saves ?? []).map((k) => names.abilityName(k)).join(', '),
        },
      },
      lock: { kind: 'viaLevelUp' },
    });

    const subclassLevel = cls?.subclassLevel;
    if (entry.subclassId) {
      rows.push({
        key: 'subclass',
        id: entry.subclassId,
        icon: CLASS_ICONS.has(slugOf(classId)) ? `ui:class-${slugOf(classId)}` : 'ui:build',
        name: index.has(entry.subclassId) ? localizer.name(entry.subclassId) : entry.subclassId,
        detail: {
          key: 'subclassDetail',
          params: { class: className, level: subclassLevel ?? 0 },
        },
        lock: { kind: 'subclass', params: { level: subclassLevel ?? 0 } },
      });
    } else if (subclassLevel !== undefined) {
      rows.push({
        key: 'subclass',
        id: `${classId}#subclass`,
        icon: 'ui:build',
        name: '',
        empty: true,
        detail: { key: 'subclassDetail', params: { class: className, level: subclassLevel } },
      });
    }
  }

  const backgroundId = slotPick(src, 'background');
  const background = backgroundId ? index.get(backgroundId) : undefined;
  if (backgroundId) {
    const bg = background?.type === 'background' ? background : undefined;
    rows.push({
      key: 'background',
      id: backgroundId,
      icon: 'ui:features',
      name: bg ? localizer.name(backgroundId) : backgroundId,
      detail: {
        key: 'backgroundDetail',
        params: {
          skills: (bg?.skillProficiencies ?? []).map((s) => names.skillName(s)).join(', '),
        },
      },
      lock: { kind: 'fixed' },
    });
    if (bg && index.has(bg.originFeat)) {
      rows.push({
        key: 'originFeat',
        id: bg.originFeat,
        icon: 'ui:features',
        name: localizer.name(bg.originFeat),
        detail: { key: 'originFeatDetail', params: { background: localizer.name(backgroundId) } },
        lock: { kind: 'granted', params: { source: localizer.name(backgroundId) } },
      });
    }
  }
  return rows;
}

// --- Ability scores ------------------------------------------------------------------------------

export interface AbilityBonus {
  readonly amount: number;
  readonly source: string;
}

export interface AbilityRow {
  readonly key: string;
  readonly name: string;
  readonly icon: string;
  readonly base: number;
  readonly bonuses: readonly AbilityBonus[];
  readonly final: number;
  readonly modifier: number;
}

export interface AbilityTable {
  readonly rows: AbilityRow[];
  /** `standardArray` | `pointBuy` | `manual` | `roll`, from the creation decision's context. */
  readonly method?: string;
}

const ABILITY_ENTRY = /^([a-z]{3}):([+-]?\d+)$/;

/** The choice id of the system's `abilityGeneration` decision, if the character has one recorded. */
function generationChoiceId(src: BuildSource): string | undefined {
  return Object.keys(src.facts.decisions).find((id) => {
    const found = findChoice(src.index, id);
    return found !== undefined && 'abilityGeneration' in found.choice.pick;
  });
}

export function abilityTable(src: BuildSource): AbilityTable {
  const generationId = generationChoiceId(src);
  const base = new Map<string, number>();
  for (const entry of generationId ? (src.facts.decisions[generationId] ?? []) : []) {
    const m = ABILITY_ENTRY.exec(entry);
    if (m) base.set(m[1], Number(m[2]));
  }
  const rows = src.index.system().abilities.flatMap((ability): AbilityRow[] => {
    const block = src.sheet.abilities[ability.id];
    if (!block) return [];
    const bonuses = block.score.contributions
      .filter((c) => c.kind === 'ability.bonus' && (c.amount ?? 0) !== 0)
      .map((c) => ({
        amount: c.amount ?? 0,
        source: src.index.has(c.source) ? src.localizer.name(c.source) : c.source,
      }));
    const bonusSum = bonuses.reduce((sum, b) => sum + b.amount, 0);
    return [
      {
        key: ability.id,
        name: src.names.abilityName(ability.id),
        icon: `ui:${ability.id}`,
        base: base.get(ability.id) ?? block.score.value - bonusSum,
        bonuses,
        final: block.score.value,
        modifier: block.mod,
      },
    ];
  });
  const context = generationId ? src.facts.decisionContexts[generationId] : undefined;
  const method = typeof context?.['method'] === 'string' ? context['method'] : undefined;
  return { rows, ...(method ? { method } : {}) };
}

// --- Choices made --------------------------------------------------------------------------------

export interface ChoiceRow {
  readonly choiceId: string;
  readonly prompt: string;
  /** Chip labels, one per pick. */
  readonly picks: readonly string[];
  /** The level badge: a class level, or `origin` for a creation pick. */
  readonly level: number | 'origin';
  readonly selection: readonly string[];
  /** Why this choice cannot be re-picked, when it cannot. */
  readonly lock?: LockView;
}

const ABILITY_VALUE = /^([a-z]+):([+-]?\d+)$/i;

function formatPick(src: BuildSource, choiceId: string, value: string): string {
  const skill = classSkillPick(choiceId, src.index);
  if (skill) return src.names.skillName(value);
  if (src.index.has(value)) return src.localizer.name(value);
  const ability = ABILITY_VALUE.exec(value);
  if (ability) {
    const name = src.names.abilityName(ability[1]);
    return `${name} ${ability[2]}`;
  }
  return value;
}

export function choiceRows(src: BuildSource): ChoiceRow[] {
  const system = src.index.system();
  const slotIds = new Set(system.compositionSlots.map((s) => `${system.id}@0/${s.id}`));
  const rows: ChoiceRow[] = [];
  for (const choiceId of Object.keys(src.facts.decisions)) {
    if (slotIds.has(choiceId)) continue;
    const selection = src.facts.decisions[choiceId] ?? [];
    const synthetic = classSkillPick(choiceId, src.index);
    const found = synthetic ? undefined : findChoice(src.index, choiceId);
    if (!synthetic && !found) continue;
    if (found && 'abilityGeneration' in found.choice.pick) continue;

    const parsed = parseChoiceId(choiceId);
    const level =
      found?.choice.at.kind === 'creation' || parsed?.level === 0 ? 'origin' : (parsed?.level ?? 1);
    const prompt = synthetic ? '' : src.localizer.choicePrompt(choiceId).text || choiceId;
    const editable =
      synthetic !== undefined ||
      (found !== undefined &&
        ('query' in found.choice.pick ||
          'queries' in found.choice.pick ||
          'static' in found.choice.pick ||
          'literal' in found.choice.pick ||
          'abilities' in found.choice.pick));
    rows.push({
      choiceId,
      prompt,
      picks: selection.map((v) => formatPick(src, choiceId, v)),
      level,
      selection,
      ...(editable ? {} : { lock: { kind: 'unsupported' as const } }),
    });
  }
  const rank = (r: ChoiceRow): number => (r.level === 'origin' ? 0 : r.level);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.choiceId < b.choiceId ? -1 : 1));
}

// --- Proficiencies and languages -----------------------------------------------------------------

export interface ProficiencyGroup {
  readonly key: 'armor' | 'weapons' | 'tools' | 'saves' | 'skills' | 'languages';
  readonly icon: string;
  readonly items: readonly { readonly label: string; readonly expertise?: boolean }[];
}

export function proficiencyGroups(src: BuildSource): ProficiencyGroup[] {
  const { sheet, names } = src;
  const ofKind = (kind: string) =>
    sheet.proficiencies
      .filter((p) => p.kind === kind)
      .map((p) => ({ label: names.resolve(p.target) }));
  return [
    { key: 'armor', icon: 'ui:ac', items: ofKind('armor') },
    { key: 'weapons', icon: 'ui:attacks', items: ofKind('weapon') },
    {
      key: 'tools',
      icon: 'ui:proficiency',
      items: sheet.proficiencies
        .filter((p) => p.kind === 'tool')
        .map((p) => ({ label: names.toolName(p.target) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      key: 'saves',
      icon: 'ui:proficient-save',
      items: src.index
        .system()
        .abilities.filter((a) => sheet.abilities[a.id]?.saveProficient)
        .map((a) => ({ label: names.abilityName(a.id) })),
    },
    {
      key: 'skills',
      icon: 'ui:proficiency',
      items: Object.entries(sheet.skills)
        .filter(([, s]) => s.proficiency === 'proficient' || s.proficiency === 'expertise')
        .map(([slug, s]) => ({
          label: names.skillName(slug),
          ...(s.proficiency === 'expertise' ? { expertise: true } : {}),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      key: 'languages',
      icon: 'ui:language',
      items: sheet.languages.map((l) => ({ label: names.resolve(l.id) })),
    },
  ];
}
