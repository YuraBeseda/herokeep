import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { ClassEntity, SubclassEntity } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { EntityFactsComponent } from '../entity-facts.component';
import { summaryOf } from './summary-text';

const CLASS_LEVELS = 20;

/** A description that is only a bracketed placeholder, e.g. a table-column stand-in. */
const PLACEHOLDER_TEXT = /^\[[^\]]*\]$/;

interface FeatureLine {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

interface LevelRow {
  readonly level: number;
  readonly proficiency: number | undefined;
  readonly features: readonly { readonly id: string; readonly name: string }[];
  /** No feature of the class itself, but a subclass of it has one at this level. */
  readonly subclassOnly: boolean;
}

interface SpellGroup {
  readonly level: number;
  readonly spells: readonly { readonly id: string; readonly name: string }[];
}

/** Capitalised pack slug ("light" -> "Light"); the pack has no per-locale table for these. */
function slugText(slug: string): string {
  return slug.length > 0 ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug;
}

/**
 * The class entry (board LB03): what a class is, drawn entirely from the pack's own data — core
 * traits, the level-1 features, a features-by-level table for levels 1-20 (proficiency bonus from
 * the system table, the features each level row grants), the subclasses and the class's spell
 * list. It reads the content index and localizer through `EngineFacade`, so a character-scoped
 * facade shows that character's pack set. Every rule is pack data; nothing here knows a class.
 */
@Component({
  selector: 'app-class-entry',
  imports: [
    TranslocoDirective,
    RouterLink,
    EntityFactsComponent,
    HkLeafComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('library')],
  templateUrl: './class-entry.component.html',
  styleUrl: './class-entry.component.scss',
})
export class ClassEntryComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);

  readonly entity = input.required<ClassEntity>();

  protected readonly levels: readonly number[] = Array.from(
    { length: CLASS_LEVELS },
    (_, index) => index + 1,
  );

  private featureLine(id: string): FeatureLine | undefined {
    const localizer = this.engineFacade.localizer();
    const text = localizer.text(id, 'description').text;
    // A grant with no prose is not a feature to read: the SRD import marks a class-table column
    // (proficiency bonus, slot counts, ...) with a lone bracketed placeholder as its text.
    if (!text || PLACEHOLDER_TEXT.test(text.trim())) return undefined;
    return { id, name: localizer.name(id), summary: summaryOf(text) };
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

  protected readonly className = computed(() =>
    this.engineFacade.localizer().name(this.entity().id),
  );

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

  protected readonly proficiencies = computed(() => {
    const entity = this.entity();
    return {
      armor: entity.armorTraining.map(slugText),
      weapons: entity.weaponProficiencies.map(slugText),
      tools: entity.toolProficiencies.map(slugText),
    };
  });

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
      .map((subclass) => ({
        id: subclass.id,
        name: localizer.name(subclass.id),
        summary: summaryOf(localizer.text(subclass.id, 'description').text),
      }));
  });

  protected readonly rows = computed<readonly LevelRow[]>(() => {
    const entity = this.entity();
    const index = this.engineFacade.index();
    const proficiency = index.system().tables.proficiency;
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
      return {
        level,
        proficiency: proficiency[level - 1],
        features,
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
}
