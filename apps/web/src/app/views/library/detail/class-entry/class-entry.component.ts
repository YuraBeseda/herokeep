import { HkPeekLinkDirective } from '../../../../ui/description-drawer/peek-link.directive';
import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Sheet } from '@hk/engine';
import { makeEntityId, parseEntityId, type ClassEntity, type SubclassEntity } from '@hk/protocol';
import { classColumnKeys, hasProse } from '@shared/services/engine/class-columns';
import { needsSheet, optionsForChoice } from '@shared/services/engine/choice-options';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { sheetNames } from '../../../characters/sheet/play/play-names';
import { PeekService } from '../../../../ui/description-drawer/peek.service';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import {
  HkOptionsChipComponent,
  type OptionsChipOption,
} from '../../../../ui/options-chip/options-chip.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { EntityFactsComponent } from '../../../../ui/entity-facts/entity-facts.component';
import { summaryOf } from './summary-text';

const CLASS_LEVELS = 20;
/** A choice's popover lists this many options; the chip's count is the whole set. */
const POPOVER_OPTION_LIMIT = 24;

interface FeatureLine {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** The description has more than the preview shows. */
  readonly more: boolean;
}

interface ChoiceChip {
  readonly id: string;
  readonly prompt: string;
  readonly count: number;
  readonly options: readonly OptionsChipOption[];
}

interface LevelRow {
  readonly level: number;
  readonly proficiency: number | undefined;
  readonly features: readonly { readonly id: string; readonly name: string }[];
  /** The value of each extra column at this level, in `columns()` order. */
  readonly cells: readonly string[];
  readonly choices: readonly ChoiceChip[];
  /** No feature of the class itself, but a subclass of it has one at this level. */
  readonly subclassOnly: boolean;
}

interface Column {
  readonly key: string;
  /** The column feature's localized name. */
  readonly header: string;
}

interface SpellGroup {
  readonly level: number;
  readonly spells: readonly { readonly id: string; readonly name: string }[];
}

/** Capitalised pack slug ("light" -> "Light"): the last resort for a slug nothing names. */
function slugText(slug: string): string {
  return slug.length > 0 ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug;
}

/**
 * The class entry (board LB03): what a class is, drawn entirely from the pack's own data — core
 * traits, the level-1 features, a features-by-level table for levels 1-20 (proficiency bonus from
 * the system table, one column per `ClassLevelRow.extra` fact named by its column feature, the
 * features each level row grants, the options of each level's choices), the subclasses and the
 * class's spell list. It reads the content index and localizer through `EngineFacade`, so a
 * character-scoped facade shows that character's pack set. Every rule is pack data; nothing here
 * knows a class.
 */
@Component({
  selector: 'app-class-entry',
  imports: [
    TranslocoDirective,
    RouterLink,
    EntityFactsComponent,
    HkLeafComponent,
    HkOptionsChipComponent,
    HkTooltipDirective,
    HkPeekLinkDirective,
  ],
  providers: [provideTranslocoScope('library')],
  templateUrl: './class-entry.component.html',
  styleUrl: './class-entry.component.scss',
})
export class ClassEntryComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly router = inject(Router);

  readonly entity = input.required<ClassEntity>();
  /** The hero the library was opened for (`?for=`); links and popovers keep it. */
  readonly heroId = input<string | null>(null);
  /** The hero's sheet when it is loaded: a proficiency-gated pick (Expertise) is then counted from it, as the wizard step does. */
  readonly heroSheet = input<Pick<Sheet, 'skills'> | undefined>(undefined);

  private readonly peek = inject(PeekService);

  protected readonly levels: readonly number[] = Array.from(
    { length: CLASS_LEVELS },
    (_, index) => index + 1,
  );

  protected readonly className = computed(() =>
    this.engineFacade.localizer().name(this.entity().id),
  );

  /**
   * The class table's extra columns: every key of `ClassLevelRow.extra` that names a feature entity
   * of the class's pack (`<classSlug>-<fact>`), headed by that feature's localized name. A stepped
   * fact carries forward ("the highest row at or below the level", per the schema), and a column
   * that only repeats the system proficiency table is the Prof. column already drawn.
   */
  private readonly columnData = computed(() => {
    const entity = this.entity();
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const packId = parseEntityId(entity.id)?.packId;
    const proficiency = index.system().tables.proficiency;
    const keys: string[] = [];
    for (const row of entity.levels) {
      for (const key of Object.keys(row.extra ?? {})) if (!keys.includes(key)) keys.push(key);
    }
    const columns: Column[] = [];
    const values = new Map<string, string[]>();
    const columnKeys = classColumnKeys(entity, index);
    for (const key of keys) {
      const featureId = packId ? makeEntityId(packId, 'feature', key) : undefined;
      if (!featureId || !index.has(featureId)) continue;
      let last: string | number | undefined;
      const perLevel = this.levels.map((level) => {
        const raw = entity.levels.find((row) => row.level === level)?.extra?.[key];
        if (raw !== undefined) last = raw;
        return last;
      });
      if (perLevel.every((value, i) => value === proficiency[i])) continue;
      columns.push({ key, header: localizer.name(featureId) });
      values.set(
        key,
        perLevel.map((value) => (value === undefined ? '' : String(value))),
      );
    }
    return { columns, values, columnKeys };
  });

  protected readonly columns = computed(() => this.columnData().columns);

  private featureLine(id: string): FeatureLine | undefined {
    const localizer = this.engineFacade.localizer();
    const text = localizer.text(id, 'description').text;
    const slug = parseEntityId(id)?.slug ?? '';
    // A grant that IS one of the table's columns is drawn as that column, not as a feature to read;
    // a column feature that also carries prose of its own stays listed too.
    const prose = hasProse(text);
    if (this.columnData().columnKeys.has(slug) && !prose) return undefined;
    const summary = prose ? summaryOf(text) : '';
    return {
      id,
      name: localizer.name(id),
      summary,
      more: prose && text.trim().length > summary.length + 3,
    };
  }

  private grantedFeatures(grants: readonly { readonly feature: string }[]): FeatureLine[] {
    const seen = new Set<string>();
    const lines: FeatureLine[] = [];
    for (const grant of grants) {
      if (seen.has(grant.feature)) continue;
      seen.add(grant.feature);
      const line = this.featureLine(grant.feature);
      if (line) lines.push(line);
    }
    return lines;
  }

  protected readonly levelOne = computed(() => {
    const row = this.entity().levels.find((candidate) => candidate.level === 1);
    return this.grantedFeatures(row?.grants ?? []);
  });

  protected readonly skillNames = computed(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const skills = index.byType('skill');
    return this.entity().skillChoice.from.map((slug) => {
      const skill = skills.find((candidate) => candidate.id.endsWith(`/${slug}`));
      return skill ? localizer.name(skill.id) : slugText(slug);
    });
  });

  protected readonly toolNames = computed(() => {
    const names = sheetNames(this.engineFacade);
    return this.entity().toolProficiencies.map((slug) => {
      const name = names.toolName(slug);
      return name === slug ? slugText(slug) : name;
    });
  });

  /** An armor or weapon category slug named through the library's own category keys. */
  protected categoryName(
    t: (key: string) => string,
    kind: 'armor' | 'weapon',
    slug: string,
  ): string {
    const key = `class.prof.${kind}.${slug}`;
    const out = t(key);
    if (!out.endsWith(key)) return out;
    // An individual item (a weapon such as the rapier) is named by its item entity.
    const item = sheetNames(this.engineFacade).toolName(slug);
    return item === slug ? slugText(slug) : item;
  }

  protected categoryList(t: (key: string) => string, kind: 'armor' | 'weapon'): string {
    const slugs =
      kind === 'armor' ? this.entity().armorTraining : this.entity().weaponProficiencies;
    return slugs.map((slug) => this.categoryName(t, kind, slug)).join(', ');
  }

  protected readonly subclasses = computed(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const classId = this.entity().id;
    return index
      .byType('subclass')
      .filter((entity) => {
        const owner = (entity as SubclassEntity).class;
        return owner === classId || index.resolveClassRef(owner) === classId;
      })
      .map((subclass) => {
        const text = localizer.text(subclass.id, 'description').text;
        const summary = summaryOf(text);
        return {
          id: subclass.id,
          name: localizer.name(subclass.id),
          summary,
          more: text.trim().length > summary.length + 3,
        };
      });
  });

  /** The library root, with the hero context when there is one (the chips' "See all" link). */
  protected readonly libraryRootHref = computed(() => {
    const hero = this.heroId();
    return this.router.serializeUrl(
      this.router.createUrlTree(['/library'], hero ? { queryParams: { for: hero } } : {}),
    );
  });

  private libraryHref(id: string): string {
    const hero = this.heroId();
    return this.router.serializeUrl(
      this.router.createUrlTree(['/library', id], hero ? { queryParams: { for: hero } } : {}),
    );
  }

  protected readonly rows = computed<readonly LevelRow[]>(() => {
    const entity = this.entity();
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const proficiency = index.system().tables.proficiency;
    const { columns, values } = this.columnData();
    const subclassLevels = new Set(
      this.subclasses().flatMap((subclass) => {
        const full = index.get(subclass.id) as SubclassEntity | undefined;
        return (full?.levels ?? []).filter((row) => row.grants.length > 0).map((row) => row.level);
      }),
    );
    return this.levels.map((level): LevelRow => {
      const row = entity.levels.find((candidate) => candidate.level === level);
      const features = this.grantedFeatures(row?.grants ?? []).map(({ id, name }) => ({
        id,
        name,
      }));
      const choices = (row?.choices ?? []).flatMap((choice): ChoiceChip[] => {
        const offer = optionsForChoice(choice, index, {
          ownerId: entity.id,
          localizer,
          sheet: needsSheet(choice) ? this.heroSheet() : undefined,
          href: (id) => this.libraryHref(id),
          limit: POPOVER_OPTION_LIMIT,
        });
        if (offer.count === 0) return [];
        return [
          {
            id: choice.id,
            prompt: localizer.choicePrompt(choice.id).text || choice.prompt,
            count: offer.count,
            options: offer.options,
          },
        ];
      });
      return {
        level,
        proficiency: proficiency[level - 1],
        features,
        cells: columns.map((column) => values.get(column.key)?.[level - 1] ?? ''),
        choices,
        subclassOnly: features.length === 0 && subclassLevels.has(level),
      };
    });
  });

  protected readonly spellGroups = computed<readonly SpellGroup[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const collator = new Intl.Collator(this.localeService.locale(), { sensitivity: 'base' });
    const byLevel = new Map<number, { id: string; name: string }[]>();
    for (const spell of index.query({ type: 'spell', classes: [this.entity().id] })) {
      const level = (spell as { level: number }).level;
      const group = byLevel.get(level) ?? [];
      group.push({ id: spell.id, name: localizer.name(spell.id) });
      byLevel.set(level, group);
    }
    return [...byLevel.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, spells]) => ({
        level,
        spells: spells.sort((a, b) => collator.compare(a.name, b.name)),
      }));
  });

  protected readonly spellCount = computed(() =>
    this.spellGroups().reduce((total, group) => total + group.spells.length, 0),
  );

  /** Opens a feature's full text in the description drawer (its header links to the full entry). */
  protected showFullText(event: Event, id: string): void {
    const target = event.currentTarget;
    this.peek.open(id, target instanceof HTMLElement ? target : undefined);
  }
}
