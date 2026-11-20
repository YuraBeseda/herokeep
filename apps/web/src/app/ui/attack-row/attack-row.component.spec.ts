import { hintOf, mount } from '../testing/harness';
import { HkAttackRowComponent } from './attack-row.component';

const base = {
  name: 'Longsword',
  icon: 'gi:broadsword',
  toHit: 5,
  damage: '1d8+3',
  damageType: { label: 'slashing', damage: 'slashing' },
};

describe('HkAttackRowComponent', () => {
  it('shows the weapon glyph, name, signed to-hit and damage', async () => {
    const { el } = await mount(HkAttackRowComponent, base);
    expect(el.querySelector('.hk-iring hk-icon')).not.toBeNull();
    expect(el.querySelector('.hk-arow__name')!.textContent?.trim()).toBe('Longsword');
    expect(el.querySelector('.hk-arow__hit')!.textContent?.trim()).toBe('+5');
    expect(el.querySelector('.hk-arow__dmg')!.textContent?.trim()).toBe('1d8+3');
  });

  it('shows the damage type as a tinted tag carrying the word', async () => {
    const { el } = await mount(HkAttackRowComponent, base);
    const tag = el.querySelector<HTMLElement>('.hk-arow__type hk-tag-chip')!;
    expect(tag.textContent?.trim()).toBe('slashing');
    expect(tag.style.getPropertyValue('--dmg')).toBe('var(--damage-slashing)');
  });

  it('renders property, mastery and equipped tags with their hints', async () => {
    const { el } = await mount(HkAttackRowComponent, {
      ...base,
      tags: [
        { label: 'versatile 1d10' },
        { label: 'Sap', icon: 'ui:mastery', hint: 'Weapon mastery: Sap' },
        { label: 'equipped', tone: 'dark', icon: 'ui:equip' },
      ],
    });
    const tags = Array.from(el.querySelectorAll<HTMLElement>('.hk-arow__tags hk-tag-chip'));
    expect(tags.map((t) => t.textContent?.trim())).toEqual(['versatile 1d10', 'Sap', 'equipped']);
    expect(hintOf(tags[1])).toBe('Weapon mastery: Sap');
    expect(tags[2].classList.contains('hk-tag-chip--dark')).toBe(true);
  });

  it('marks an attuned weapon with a gem whose meaning is only in its hint', async () => {
    const { fixture, el } = await mount(HkAttackRowComponent, base);
    expect(el.querySelector('.hk-arow__gem')).toBeNull();
    fixture.componentRef.setInput('attuned', 'Attuned');
    await fixture.whenStable();
    const gem = el.querySelector('.hk-arow__gem')!;
    expect(gem.getAttribute('role')).toBe('img');
    expect(gem.getAttribute('aria-label')).toBe('Attuned');
    expect(hintOf(gem)).toBe('Attuned');
    expect(gem.textContent?.trim()).toBe('');
  });

  it('has one dice button named after the weapon; its menu rolls to-hit or damage', async () => {
    const { fixture, el } = await mount(HkAttackRowComponent, base);
    const buttons = el.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Roll Longsword');
    buttons[0].click();
    await fixture.whenStable();
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('.cdk-overlay-container .hk-menu [role="menuitem"]'),
    );
    expect(items.map((i) => `${i.querySelector('.hk-menu__label')?.textContent?.trim()} ${i.querySelector('.hk-menu__detail')?.textContent?.trim()}`)).toEqual([
      'Attack roll +5',
      'Damage 1d8+3 slashing',
    ]);
    const rolled: string[] = [];
    fixture.componentInstance.roll.subscribe(() => rolled.push('hit'));
    fixture.componentInstance.rollDamage.subscribe(() => rolled.push('damage'));
    fixture.componentInstance.menuItems()[0].run();
    fixture.componentInstance.menuItems()[1].run();
    expect(rolled).toEqual(['hit', 'damage']);
  });

  it('ellipsises a long name and keeps the full text in a hint', async () => {
    const long = 'Greatsword of the Very Long Translated Name';
    const { el } = await mount(HkAttackRowComponent, { ...base, name: long });
    expect(hintOf(el.querySelector('.hk-arow__name')!)).toBe(long);
  });
});

describe('HkAttackRowComponent breakdown controls', () => {
  it('names the to-hit and damage controls by weapon, value and "show breakdown"', async () => {
    const { el } = await mount(HkAttackRowComponent, { ...base, inspectable: true });
    expect(el.querySelector('.hk-arow__hit')!.getAttribute('aria-label')).toBe(
      'Longsword to hit +5, show breakdown',
    );
    expect(el.querySelector('.hk-arow__dmg')!.getAttribute('aria-label')).toBe(
      'Longsword damage 1d8+3, show breakdown',
    );
  });

  it('carries no label when not inspectable', async () => {
    const { el } = await mount(HkAttackRowComponent, base);
    expect(el.querySelector('.hk-arow__hit')!.getAttribute('aria-label')).toBeNull();
  });
});
