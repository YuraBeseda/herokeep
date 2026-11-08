import { accessibleName, hintOf, mount } from '../testing/harness';
import { HkSpellRowComponent } from './spell-row.component';

const base = { name: 'Bless', icon: 'gi:fire-spell-cast' };

describe('HkSpellRowComponent', () => {
  it('shows the glyph and the name', async () => {
    const { el } = await mount(HkSpellRowComponent, base);
    expect(el.querySelector('.hk-srow__glyph')).not.toBeNull();
    expect(el.querySelector('.hk-srow__name')!.textContent?.trim()).toBe('Bless');
  });

  it('shows the spell level as a wax seal with the numeral and a hint', async () => {
    const { el } = await mount(HkSpellRowComponent, {
      ...base,
      level: 3,
      levelHint: 'Level 3 spell',
    });
    const seal = el.querySelector('hk-wax-seal')!;
    expect(seal.querySelector('text.hk-seal-txt--emboss')!.textContent).toBe('III');
    expect(seal.querySelector('svg')!.getAttribute('aria-label')).toBe('Level 3 spell');
  });

  it('draws no level seal for a cantrip', async () => {
    const { el } = await mount(HkSpellRowComponent, { ...base, level: null });
    expect(el.querySelector('hk-wax-seal')).toBeNull();
  });

  it('marks always-prepared with a glyph that explains itself by hint only', async () => {
    const { fixture, el } = await mount(HkSpellRowComponent, base);
    expect(el.querySelector('.hk-srow__always')).toBeNull();
    fixture.componentRef.setInput('alwaysPrepared', 'Always prepared (Oath of Devotion)');
    await fixture.whenStable();
    const mark = el.querySelector('.hk-srow__always')!;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('Always prepared (Oath of Devotion)');
    expect(hintOf(mark)).toBe('Always prepared (Oath of Devotion)');
    expect(el.textContent).not.toContain('Oath');
  });

  it('marks concentration with the orb glyph and a hint', async () => {
    const { el } = await mount(HkSpellRowComponent, {
      ...base,
      concentrating: 'Concentrating on Bless, round 3',
    });
    const orb = el.querySelector('.hk-srow__orb')!;
    expect(orb.querySelector('use')!.getAttribute('href')).toContain('ui-concentration');
    expect(hintOf(orb)).toBe('Concentrating on Bless, round 3');
    expect(orb.getAttribute('aria-label')).toBe('Concentrating on Bless, round 3');
    expect(el.textContent).not.toContain('round 3');
  });

  it('dims an unprepared spell', async () => {
    const { el } = await mount(HkSpellRowComponent, { ...base, prepared: false });
    expect(el.classList.contains('hk-srow--unprepared')).toBe(true);
  });

  it('has a Cast button named after the spell that emits cast', async () => {
    const { fixture, el } = await mount(HkSpellRowComponent, base);
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(accessibleName(button)).toBe('Cast Bless');
    let cast = 0;
    fixture.componentInstance.cast.subscribe(() => cast++);
    button.click();
    expect(cast).toBe(1);
  });

  it('blocks Cast with the reason only in the hint', async () => {
    const reason = 'No level 2 slot left; cast with a higher slot?';
    const { fixture, el } = await mount(HkSpellRowComponent, {
      ...base,
      castDisabledReason: reason,
    });
    const button = el.querySelector<HTMLButtonElement>('button')!;
    let cast = 0;
    fixture.componentInstance.cast.subscribe(() => cast++);
    button.click();
    expect(cast).toBe(0);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(hintOf(button)).toBe(reason);
    // hk-button keeps the reason as a hidden description; nothing visible prints it.
    const visible = el.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('[hidden]').forEach((node) => node.remove());
    expect(visible.textContent).not.toContain('No level 2');
  });

  it('hides Cast when the row is only a pick list', async () => {
    const { el } = await mount(HkSpellRowComponent, { ...base, castable: false });
    expect(el.querySelector('button')).toBeNull();
  });

  it('marks a chosen spell with exactly one tick: a selected wax seal, no checkbox', async () => {
    const { el } = await mount(HkSpellRowComponent, {
      ...base,
      castable: false,
      chosen: true,
      chosenHint: 'Chosen',
    });
    const ticks = el.querySelectorAll('hk-wax-seal.hk-wax-seal--selected');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].querySelector('svg')!.getAttribute('aria-label')).toBe('Chosen');
    expect(el.querySelector('input')).toBeNull();
  });

  it('ellipsises a long name and keeps the full text in a hint', async () => {
    const long = "Tasha's Hideous Laughter and a very long translated name";
    const { el } = await mount(HkSpellRowComponent, { ...base, name: long });
    expect(hintOf(el.querySelector('.hk-srow__name')!)).toBe(long);
  });
});
