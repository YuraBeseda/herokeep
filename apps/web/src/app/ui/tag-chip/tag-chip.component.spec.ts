import { hintOf, mount } from '../testing/harness';
import { HkTagChipComponent } from './tag-chip.component';

describe('HkTagChipComponent', () => {
  it('renders the label as text', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'versatile 1d10' });
    expect(el.textContent?.trim()).toBe('versatile 1d10');
    expect(el.classList.contains('hk-tag-chip--neutral')).toBe(true);
  });

  it('applies the tone class', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'equipped', tone: 'dark' });
    expect(el.classList.contains('hk-tag-chip--dark')).toBe(true);
  });

  it('draws a damage tag with the damage-type ink token', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'slashing', damage: 'slashing' });
    expect(el.classList.contains('hk-tag-chip--damage')).toBe(true);
    expect(el.style.getPropertyValue('--dmg')).toBe('var(--damage-slashing)');
    expect(el.textContent?.trim()).toBe('slashing');
  });

  it('shows a leading glyph', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'Sap', icon: 'ui:mastery' });
    expect(el.querySelector('hk-icon')).not.toBeNull();
  });

  it('defaults the hint to the full label so an ellipsised name stays readable', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'A very long property name' });
    expect(hintOf(el)).toBe('A very long property name');
  });

  it('prefers an explicit hint and becomes keyboard reachable', async () => {
    const { el } = await mount(HkTagChipComponent, {
      label: 'Sap',
      hint: 'Weapon mastery: Sap',
    });
    expect(hintOf(el)).toBe('Weapon mastery: Sap');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('is not a tab stop without an explicit hint', async () => {
    const { el } = await mount(HkTagChipComponent, { label: 'ritual' });
    expect(el.hasAttribute('tabindex')).toBe(false);
  });
});
