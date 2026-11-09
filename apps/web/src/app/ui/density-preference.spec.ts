import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DisplayPrefsService } from '@shared/services/theme/display-prefs.service';
import { HkFeatureRowComponent } from './feature-row/feature-row.component';
import { HkSkillRowComponent } from './skill-row/skill-row.component';
import { HkSpellRowComponent } from './spell-row/spell-row.component';
import { mount } from './testing/harness';

/**
 * Settings, Appearance, Density: the sheet's list rows (skills, spells, features) read the saved
 * preference unless a caller pins a density (the phone sheet pins "comfortable").
 */
const ROWS: readonly (readonly [string, Type<unknown>, Record<string, unknown>, string])[] = [
  [
    'skill row',
    HkSkillRowComponent,
    { name: 'Athletics', modifier: 3, proficiency: 'none', proficiencyHint: 'Not proficient' },
    'hk-sk--comfortable',
  ],
  [
    'spell row',
    HkSpellRowComponent,
    { name: 'Bless', icon: 'gi:fire-spell-cast' },
    'hk-srow--comfortable',
  ],
  [
    'feature row',
    HkFeatureRowComponent,
    { name: 'Divine Smite', icon: 'gi:templar-shield', sourceHint: 'From Paladin' },
    'hk-feat--comfortable',
  ],
];

describe.each(ROWS)('%s density', (_name, component, inputs, comfortableClass) => {
  afterEach(() => localStorage.removeItem('hk.density'));

  it('is compact by default', async () => {
    localStorage.removeItem('hk.density');
    const { el } = await mount(component, { ...inputs });
    expect(el.classList.contains(comfortableClass)).toBe(false);
  });

  it('follows the saved comfortable preference', async () => {
    localStorage.setItem('hk.density', 'comfortable');
    const { el } = await mount(component, { ...inputs });
    expect(el.classList.contains(comfortableClass)).toBe(true);
  });

  it('follows the preference live when it changes', async () => {
    const { fixture, el } = await mount(component, { ...inputs });
    expect(el.classList.contains(comfortableClass)).toBe(false);

    TestBed.inject(DisplayPrefsService).setDensity('comfortable');
    await fixture.whenStable();

    expect(el.classList.contains(comfortableClass)).toBe(true);
  });

  it('lets a caller pin compact over a comfortable preference', async () => {
    localStorage.setItem('hk.density', 'comfortable');
    const { el } = await mount(component, { ...inputs, density: 'compact' });
    expect(el.classList.contains(comfortableClass)).toBe(false);
  });
});
