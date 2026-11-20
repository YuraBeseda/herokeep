import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { seedFighter } from '../testing/character-fixtures';
import { AbilitiesLeafComponent } from './abilities-leaf/abilities-leaf.component';
import { AttacksLeafComponent } from './attacks-leaf/attacks-leaf.component';
import { setupLeafSpec } from './play-spec-support';
import { ResourcesLeafComponent } from './resources-leaf/resources-leaf.component';

// R37: the provenance popover (`hkDerived`) that the old play tab had on ability scores and saves,
// skill totals, attack to-hit and damage bonus, and a resource's maximum. Same pattern as the AC
// popover spec in `vitals-leaf.component.spec.ts`: activate the value, see the contribution rows
// (localized source names) in the dialog overlay.
//
// WHY the sheet is augmented for save/skill/attack in the specs below: the engine now lists the
// ability modifier and proficiency first in those breakdowns, but a level-1 fighter has no other
// `save.bonus`/`skill.bonus`/`attack.bonus` entries, so these specs give the leaves a sheet with
// real-shaped extra contributions. The ability score and resource maximum keep genuine contributions.
describe('derived-value breakdown popovers on the sheet leaves', () => {
  setupLeafSpec();

  const FIGHTER = 'srd-5e-2024:class/fighter';
  const SOLDIER = 'srd-5e-2024:background/soldier';

  function overlayRows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.cdk-overlay-container .derived-popover__row'),
    );
  }
  const dialogOpen = (): boolean =>
    document.querySelector('.cdk-overlay-container .derived-popover__title') !== null;

  /** Replaces the store's sheet with a copy whose save/skill/attack values carry contributions. */
  function withContributions(): void {
    const store = TestBed.inject(CharacterStore);
    const real = store.sheet;
    const augmented = computed(() => {
      const sheet = real();
      if (!sheet) return sheet;
      const copy = structuredClone(sheet);
      copy.abilities['str'].save.contributions = [
        { source: FIGHTER, kind: 'save.bonus', amount: 2, key: 'prof' },
        { source: SOLDIER, kind: 'save.bonus', amount: 1, key: 'bg' },
      ];
      copy.skills['athletics'].total.contributions = [
        { source: FIGHTER, kind: 'skill.bonus', amount: 2, key: 'prof' },
      ];
      copy.attacks[0].toHit.contributions = [
        { source: FIGHTER, kind: 'attack.bonus', amount: 2, key: 'prof' },
      ];
      copy.attacks[0].damage.bonus.contributions = [
        { source: SOLDIER, kind: 'damage.bonus', amount: 3, key: 'str' },
      ];
      return copy;
    });
    Object.defineProperty(store, 'sheet', { value: augmented });
  }

  async function mount<T>(type: new () => T, augment = false) {
    await seedFighter('Ivan');
    if (augment) withContributions();
    const fixture = TestBed.createComponent(type);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function activate(el: Element | null): HTMLElement {
    expect(el, 'the value must be an activatable control').not.toBeNull();
    const trigger = el as HTMLElement;
    trigger.focus();
    trigger.click();
    TestBed.tick();
    return trigger;
  }

  function expectRows(...sources: string[]): void {
    const text = overlayRows()
      .map((r) => r.textContent ?? '')
      .join('|');
    expect(overlayRows().length).toBeGreaterThanOrEqual(sources.length);
    for (const source of sources) expect(text).toContain(source);
  }

  async function closeWithEscape(trigger: HTMLElement): Promise<void> {
    document
      .querySelector('.cdk-overlay-container .derived-popover__title')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    expect(dialogOpen(), 'Escape closes the dialog').toBe(false);
    expect(document.activeElement, 'focus returns to the trigger').toBe(trigger);
  }

  it('the ability score opens its breakdown rows (genuine engine contributions)', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    activate(compiled.querySelector('[data-ability="str"] [data-breakdown="score"]'));
    expect(overlayRows().length).toBeGreaterThanOrEqual(1);
  });

  it('the proficient save lists its contributions; Escape closes and focus returns', async () => {
    const compiled = await mount(AbilitiesLeafComponent, true);
    const trigger = activate(
      compiled.querySelector('[data-ability="str"] [data-breakdown="save"]'),
    );
    expectRows('Fighter', 'Soldier');
    expect(overlayRows().map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('+2'), expect.stringContaining('+1')]),
    );
    await closeWithEscape(trigger);
  });

  it('the proficient skill total lists its contributions; Escape closes and focus returns', async () => {
    const compiled = await mount(AbilitiesLeafComponent, true);
    const trigger = activate(
      compiled.querySelector('hk-skill-row [data-breakdown="total"][aria-label^="Athletics"]'),
    );
    expectRows('Fighter');
    await closeWithEscape(trigger);
  });

  it('the attack to-hit and damage bonus each list their contributions', async () => {
    const compiled = await mount(AttacksLeafComponent, true);
    expect(TestBed.inject(CharacterStore).sheet()!.attacks.length).toBeGreaterThan(0);
    const hit = activate(compiled.querySelector('[data-breakdown="hit"]'));
    expectRows('Fighter');
    await closeWithEscape(hit);
    const dmg = activate(compiled.querySelector('[data-breakdown="damage"]'));
    expectRows('Soldier');
    await closeWithEscape(dmg);
  });

  it('a level-1 fighter proficient skill lists the ability modifier and proficiency, not "No modifiers."', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    activate(
      compiled.querySelector('hk-skill-row [data-breakdown="total"][aria-label^="Athletics"]'),
    );
    const text = overlayRows()
      .map((r) => r.textContent ?? '')
      .join('|');
    expect(text).toContain('Strength modifier');
    expect(text).toContain('Proficiency');
    expect(document.querySelector('.cdk-overlay-container .derived-popover__empty')).toBeNull();
  });

  it('the resource maximum opens its breakdown rows (genuine engine contributions)', async () => {
    const compiled = await mount(ResourcesLeafComponent);
    activate(compiled.querySelector('hk-pool-bar [data-breakdown="max"]'));
    expect(overlayRows().length).toBeGreaterThanOrEqual(1);
  });

  it('a breakdown value is keyboard reachable: focusable with the button role', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    const score = compiled.querySelector('[data-ability="str"] [data-breakdown="score"]')!;
    expect(score.getAttribute('role')).toBe('button');
    expect(score.getAttribute('tabindex')).toBe('0');
  });
});
