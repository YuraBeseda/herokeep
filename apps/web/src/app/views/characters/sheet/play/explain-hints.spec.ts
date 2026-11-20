import { TestBed } from '@angular/core/testing';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../../assets/i18n/characters/uk.json';
import { hintOf } from '../../../../ui/testing/harness';
import { seedFighter } from '../testing/character-fixtures';
import { setupLeafSpec } from './play-spec-support';
import { VitalsLeafComponent } from './vitals-leaf/vitals-leaf.component';

describe('rules hints (sheet.explain.*)', () => {
  setupLeafSpec();

  const explain = charactersEn.sheet.explain;

  it('has every explain key in en, ru and uk, none containing a digit', () => {
    const flat = (o: Record<string, unknown>): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? flat(v as Record<string, unknown>).map((x) => `${k}.${x}`) : [k],
      );
    const keys = flat(explain).sort();
    expect(keys.length).toBeGreaterThan(12);
    for (const locale of [charactersRu, charactersUk]) {
      expect(flat(locale.sheet.explain).sort()).toEqual(keys);
    }
    for (const locale of [charactersEn, charactersRu, charactersUk]) {
      expect(JSON.stringify(locale.sheet.explain)).not.toMatch(/\d/);
    }
  });

  it('the vitals tiles show their explanation as a hint', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const hint = (selector: string): string | null => hintOf(root.querySelector(selector)!);

    expect(hint('.vitals__initiative')).toBe(explain.initiative);
    expect(hint('.vitals__prof')).toBe(explain.proficiencyBonus);
    expect(hint('.vitals__passive')).toBe(explain.passivePerception);
    expect(hint('.vitals__hit-dice')).toBe(explain.hitDice);
    expect(hint('.vitals__speed')).toContain(explain.speed);
    expect(hint('.vitals__ac')).toContain(explain.armorClass);
  });
});
