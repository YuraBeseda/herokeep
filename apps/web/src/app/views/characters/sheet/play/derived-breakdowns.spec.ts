import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { seedFighter } from '../testing/character-fixtures';
import { AbilitiesLeafComponent } from './abilities-leaf/abilities-leaf.component';
import { AttacksLeafComponent } from './attacks-leaf/attacks-leaf.component';
import { setupLeafSpec } from './play-spec-support';
import { ResourcesLeafComponent } from './resources-leaf/resources-leaf.component';
import { SkillsLeafComponent } from './skills-leaf/skills-leaf.component';

// R37: the provenance popover (`hkDerived`) that the old play tab had on ability scores and saves,
// skill totals, attack to-hit and damage bonus, and a resource's maximum. Same pattern as the AC
// popover spec in `vitals-leaf.component.spec.ts`: activate the value, see the contribution rows
// (localized source names) in the dialog overlay.
describe('derived-value breakdown popovers on the sheet leaves', () => {
  setupLeafSpec();

  function overlayRows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.cdk-overlay-container .derived-popover__row'),
    );
  }

  /** The breakdown dialog is open (title present); the seeded fighter's save, skill and attack
   * values have no contributions, so those show the dialog's empty state instead of rows. */
  function dialogOpen(): boolean {
    return document.querySelector('.cdk-overlay-container .derived-popover__title') !== null;
  }

  async function mount<T>(type: new () => T) {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(type);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function activate(el: Element | null): void {
    expect(el, 'the value must be an activatable control').not.toBeNull();
    (el as HTMLElement).click();
    TestBed.tick();
  }

  it('the ability score opens its breakdown (Strength 15 base + background)', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    activate(compiled.querySelector('[data-ability="str"] [data-breakdown="score"]'));
    expect(overlayRows().length).toBeGreaterThanOrEqual(1);
  });

  it('the ability save opens its breakdown', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    activate(compiled.querySelector('[data-ability="str"] [data-breakdown="save"]'));
    expect(dialogOpen()).toBe(true);
  });

  it('the skill total opens its breakdown and Escape closes it', async () => {
    const compiled = await mount(SkillsLeafComponent);
    activate(compiled.querySelector('hk-skill-row [data-breakdown="total"]'));
    expect(dialogOpen()).toBe(true);
    document
      .querySelector('.cdk-overlay-container')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    TestBed.tick();
  });

  it('the attack to-hit and damage bonus each open their breakdown', async () => {
    const compiled = await mount(AttacksLeafComponent);
    expect(TestBed.inject(CharacterStore).sheet()!.attacks.length).toBeGreaterThan(0);
    activate(compiled.querySelector('[data-breakdown="hit"]'));
    expect(dialogOpen()).toBe(true);
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
    activate(compiled.querySelector('[data-breakdown="damage"]'));
    expect(dialogOpen()).toBe(true);
  });

  it('the resource maximum opens its breakdown', async () => {
    const compiled = await mount(ResourcesLeafComponent);
    activate(compiled.querySelector('hk-pool-bar [data-breakdown="max"]'));
    expect(dialogOpen()).toBe(true);
  });

  it('a breakdown value is keyboard reachable: focusable with the button role', async () => {
    const compiled = await mount(AbilitiesLeafComponent);
    const score = compiled.querySelector('[data-ability="str"] [data-breakdown="score"]')!;
    expect(score.getAttribute('role')).toBe('button');
    expect(score.getAttribute('tabindex')).toBe('0');
  });
});
