import { accessibleName, hintOf, mount, nameOf } from '../testing/harness';
import { HkSkillRowComponent } from './skill-row.component';

const base = {
  name: 'Athletics',
  modifier: 3,
  proficiency: 'none',
  proficiencyHint: 'Not proficient',
};

describe('HkSkillRowComponent', () => {
  it('shows the name and the signed modifier', async () => {
    const { el } = await mount(HkSkillRowComponent, base);
    expect(el.querySelector('.hk-sk__name')!.textContent?.trim()).toBe('Athletics');
    expect(el.querySelector('.hk-sk__mod')!.textContent?.trim()).toBe('+3');
  });

  it('writes a negative modifier with a true minus', async () => {
    const { el } = await mount(HkSkillRowComponent, { ...base, modifier: -1 });
    expect(el.querySelector('.hk-sk__mod')!.textContent?.trim()).toBe('−1');
  });

  it.each([
    ['none', 'Not proficient'],
    ['proficient', 'Proficient (+3)'],
    ['expertise', 'Expertise (+6)'],
  ])('explains the %s dot through its hint and accessible name', async (proficiency, hint) => {
    const { el } = await mount(HkSkillRowComponent, {
      ...base,
      proficiency,
      proficiencyHint: hint,
    });
    const dot = el.querySelector('.hk-dot')!;
    expect(dot.classList.contains(`hk-dot--${proficiency}`)).toBe(true);
    expect(dot.getAttribute('role')).toBe('img');
    expect(nameOf(dot)).toBe(hint);
    expect(hintOf(dot)).toBe(hint);
  });

  it('prints no legend: the row text is only the name and the modifier', async () => {
    const { el } = await mount(HkSkillRowComponent, {
      ...base,
      proficiency: 'expertise',
      proficiencyHint: 'Expertise (+6)',
    });
    expect(el.textContent).not.toContain('Expertise');
    expect(el.textContent?.replace(/\s+/g, ' ').trim()).toBe('Athletics+3');
  });

  it('shows the disadvantage mark with its cause only in the hint', async () => {
    const { fixture, el } = await mount(HkSkillRowComponent, base);
    expect(el.querySelector('.hk-dis')).toBeNull();
    fixture.componentRef.setInput('disadvantage', 'Disadvantage: chain mail');
    await fixture.whenStable();
    const mark = el.querySelector('.hk-dis')!;
    expect(mark.querySelector('hk-icon')).not.toBeNull();
    expect(mark.textContent?.trim()).toBe('Disadvantage');
    expect(hintOf(mark)).toBe('Disadvantage: chain mail');
    expect(el.textContent).not.toContain('chain mail');
  });

  it('has a roll button named after the skill that emits roll', async () => {
    const { fixture, el } = await mount(HkSkillRowComponent, base);
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(accessibleName(button)).toBe('Roll Athletics');
    let rolled = 0;
    fixture.componentInstance.roll.subscribe(() => rolled++);
    button.click();
    expect(rolled).toBe(1);
  });

  it('ellipsises a long name and keeps the full text in a hint', async () => {
    const long = 'Animal Handling and other very long translated skill names';
    const { el } = await mount(HkSkillRowComponent, { ...base, name: long });
    expect(hintOf(el.querySelector('.hk-sk__name')!)).toBe(long);
  });

  it('applies the density and surface modifiers', async () => {
    const { el } = await mount(HkSkillRowComponent, {
      ...base,
      density: 'comfortable',
      surface: 'leather',
    });
    expect(el.classList.contains('hk-sk--comfortable')).toBe(true);
    expect(el.classList.contains('hk-sk--leather')).toBe(true);
  });
});

describe('HkSkillRowComponent breakdown control', () => {
  it('names the inspectable modifier by skill, value and "show breakdown"', async () => {
    const { el } = await mount(HkSkillRowComponent, { ...base, modifier: 5, inspectable: true });
    const mod = el.querySelector('.hk-sk__mod')!;
    expect(mod.getAttribute('role')).toBe('button');
    expect(mod.getAttribute('aria-label')).toBe('Athletics +5, show breakdown');
  });

  it('has no role or label when not inspectable', async () => {
    const { el } = await mount(HkSkillRowComponent, base);
    const mod = el.querySelector('.hk-sk__mod')!;
    expect(mod.getAttribute('role')).toBeNull();
    expect(mod.getAttribute('aria-label')).toBeNull();
  });
});
