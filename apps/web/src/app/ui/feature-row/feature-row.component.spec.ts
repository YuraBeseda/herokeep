import { accessibleName, hintOf, mount } from '../testing/harness';
import { HkFeatureRowComponent } from './feature-row.component';

const base = {
  name: 'Divine Smite',
  icon: 'gi:templar-shield',
  sourceHint: 'From Paladin, level 2',
};

describe('HkFeatureRowComponent', () => {
  it('shows the source glyph, named by the source hint, and the feature name', async () => {
    const { el } = await mount(HkFeatureRowComponent, base);
    const glyph = el.querySelector('.hk-feat__src')!;
    expect(glyph.getAttribute('role')).toBe('img');
    expect(glyph.getAttribute('aria-label')).toBe('From Paladin, level 2');
    expect(hintOf(glyph)).toBe('From Paladin, level 2');
    expect(el.querySelector('.hk-feat__name')!.textContent?.trim()).toBe('Divine Smite');
  });

  it('shows a level badge with the gained-at hint', async () => {
    const { el } = await mount(HkFeatureRowComponent, {
      ...base,
      level: 3,
      levelHint: 'Gained at level 3',
    });
    const badge = el.querySelector('.hk-lvlbadge')!;
    expect(badge.textContent?.trim()).toBe('3');
    expect(hintOf(badge)).toBe('Gained at level 3');
    expect(badge.getAttribute('aria-label')).toBe('Gained at level 3');
  });

  it('shows a source chip instead of a badge for species, background or feats', async () => {
    const { el } = await mount(HkFeatureRowComponent, { ...base, source: 'Dwarf' });
    expect(el.querySelector('.hk-lvlbadge')).toBeNull();
    expect(el.querySelector('hk-tag-chip')!.textContent?.trim()).toBe('Dwarf');
  });

  it('shows a linked-resource chip next to the level badge', async () => {
    const { el } = await mount(HkFeatureRowComponent, {
      ...base,
      level: 2,
      levelHint: 'Gained at level 2',
      resource: '(Action Surge)',
    });
    expect(el.querySelector('.hk-lvlbadge')).not.toBeNull();
    expect(el.querySelector('.hk-feat__resource')!.textContent?.trim()).toBe('(Action Surge)');
  });

  it('has a details button named after the feature that emits details', async () => {
    const { fixture, el } = await mount(HkFeatureRowComponent, base);
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(accessibleName(button)).toBe('Details Divine Smite');
    let opened = 0;
    fixture.componentInstance.details.subscribe(() => opened++);
    button.click();
    expect(opened).toBe(1);
  });

  it('dims a row from an inactive level', async () => {
    const { el } = await mount(HkFeatureRowComponent, { ...base, dimmed: true });
    expect(el.classList.contains('hk-feat--dimmed')).toBe(true);
  });

  it('ellipsises a long name and keeps the full text in a hint', async () => {
    const long = 'Channel Divinity: a very long translated feature name that overflows';
    const { el } = await mount(HkFeatureRowComponent, { ...base, name: long });
    expect(hintOf(el.querySelector('.hk-feat__name')!)).toBe(long);
  });
});
