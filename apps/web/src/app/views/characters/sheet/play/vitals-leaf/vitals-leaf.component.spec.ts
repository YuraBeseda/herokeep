import { TestBed } from '@angular/core/testing';
import { propose } from '@hk/engine';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import shellEn from '../../../../../../assets/i18n/shell/en.json';
import { seedFighter } from '../../testing/character-fixtures';
import { buttonNamed, pollUntil, setupLeafSpec } from '../play-spec-support';
import { VitalsLeafComponent } from './vitals-leaf.component';

// task-2-brief.md: the HP strap (`hk-hp-gauge`), the AC shield and the vitals tiles. Every scenario
// seeds a REAL fighter-1 stream (`seedFighter`, hp.max 12, hp.current topped up to 12 by the wizard's
// explicit `hp.changed {kind: 'set'}` — controller ruling R11) and drives the rendered DOM, so each
// assertion exercises the exact `propose.*` -> `CharacterStore.appendTx` wiring a click would.
describe('VitalsLeafComponent', () => {
  setupLeafSpec();

  const damageLabel = shellEn.ui.hp.damage;
  const healLabel = shellEn.ui.hp.heal;
  const tempLabel = shellEn.ui.hp.temp;

  function amountInput(compiled: HTMLElement): HTMLInputElement {
    return compiled.querySelector<HTMLInputElement>('.hk-hp-gauge__amount')!;
  }

  async function typeAmount(
    fixture: { whenStable(): Promise<unknown> },
    input: HTMLInputElement,
    value: number,
  ): Promise<void> {
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it("renders fighter-1's hp max / AC / proficiency bonus straight off the store's sheet (12 / 19 / +2)", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // AC: the shield badge draws the number and is named "Armor class 19".
    const shield = compiled.querySelector('hk-shield-badge')!;
    expect(shield.querySelector('.hk-shield-num')?.textContent?.trim()).toBe('19');
    expect(shield.querySelector('svg')?.getAttribute('aria-label')).toBe('Armor class 19');
    expect(compiled.querySelector('.vitals__prof .hk-stat-tile__value')?.textContent?.trim()).toBe(
      '+2',
    );
    // Controller ruling R11: `CreateWizardState.buildTransaction()` tops current HP up to the
    // derived max via an explicit `hp.changed {delta, kind: 'set'}` right after `level.gained`.
    expect(compiled.querySelector('.hk-hp-gauge__current')?.textContent?.trim()).toBe('12');
    expect(compiled.querySelector('.vitals__max .hk-stat-tile__value')?.textContent?.trim()).toBe(
      '12',
    );
  });

  it("opens the AC shield's hkDerived popover listing at least 3 contributions (armor, shield, fighting style), localized", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLElement>('hk-shield-badge')!.click();
    TestBed.tick();

    const overlay = document.querySelector('.cdk-overlay-container')!;
    const rows = overlay.querySelectorAll('.derived-popover__row');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = overlay.textContent ?? '';
    expect(text).toContain('Chain Mail');
    expect(text).toContain('Shield');
    expect(text).toContain('Defense');
  });

  it("renders fighter-1's hk-hp-gauge with widths matching current/max/temp off the store's sheet", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const fill = compiled.querySelector<HTMLElement>('.hk-hp-gauge__body .hk-gauge__hp')!;
    // fighter-1: hp.current 12 / hp.max 12 -> a full gauge.
    expect(fill.style.width).toBe('100%');
  });

  it("damage 5 via the amount input + Damage button appends the proposer's exact hp.changed event and drops current from 12 to 7", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 5);
    buttonNamed(compiled, damageLabel).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === 7);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'hp.changed',
      payload: { delta: -5, kind: 'damage' },
    });
    expect(characterStore.sheet()?.hp.current).toBe(7);
  });

  it('heal past max clamps to the derived max (propose.heal clamping behavior)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // Fighter-1 starts full (12/12) — damage it down first so a large heal has room to clamp.
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 5)); // -> current 7

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 100);
    buttonNamed(compiled, healLabel).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === 12);

    expect(characterStore.sheet()?.hp.current).toBe(12);
  });

  it('adding temp HP via the input + button appends hp.changed{kind:"temp"} and sets sheet.hp.temp', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 4);
    buttonNamed(compiled, tempLabel).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.temp === 4);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'hp.changed',
      payload: { delta: 4, kind: 'temp' },
    });
    expect(characterStore.sheet()?.hp.temp).toBe(4);
  });

  it('shows the hit dice and the proficiency / passive perception tiles unless compact, and carries the HP title for assistive tech', async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(VitalsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.vitals__hit-dice .hk-stat-tile__value')?.textContent).toContain(
      '1/1 d10',
    );
    expect(compiled.querySelector('legend')?.textContent?.trim()).toBe(charactersEn.sheet.hp.title);
  });
});
