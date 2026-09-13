import { TestBed } from '@angular/core/testing';
import { DiceResultComponent } from './dice-result.component';

function render(
  dice: { sides: number; value: number; kept: boolean }[],
  modifier = 0,
  total?: number,
) {
  const fixture = TestBed.createComponent(DiceResultComponent);
  fixture.componentRef.setInput('dice', dice);
  fixture.componentRef.setInput('modifier', modifier);
  fixture.componentRef.setInput('total', total);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DiceResultComponent', () => {
  it('renders one span per die, in roll order, with dropped dice struck through', () => {
    const compiled = render([
      { sides: 20, value: 5, kept: false },
      { sides: 20, value: 17, kept: true },
    ]);

    const dice = compiled.querySelectorAll('.hk-dice-result__die');
    expect(dice).toHaveLength(2);
    expect(dice[0]?.textContent?.trim()).toBe('5');
    expect(dice[0]?.classList.contains('hk-dice-result__die--dropped')).toBe(true);
    expect(dice[1]?.textContent?.trim()).toBe('17');
    expect(dice[1]?.classList.contains('hk-dice-result__die--dropped')).toBe(false);
  });

  it('renders no modifier badge when modifier is 0 (the default), and a signed badge otherwise', () => {
    const withoutModifier = render([{ sides: 8, value: 4, kept: true }]);
    expect(withoutModifier.querySelector('.hk-dice-result__modifier')).toBeNull();

    const withPositive = render([{ sides: 8, value: 4, kept: true }], 3);
    expect(withPositive.querySelector('.hk-dice-result__modifier')?.textContent?.trim()).toBe('+3');

    const withNegative = render([{ sides: 8, value: 4, kept: true }], -2);
    expect(withNegative.querySelector('.hk-dice-result__modifier')?.textContent?.trim()).toBe('-2');
  });

  it('renders no total row when total is undefined (the default), and the total otherwise', () => {
    const withoutTotal = render([{ sides: 20, value: 11, kept: true }]);
    expect(withoutTotal.querySelector('.hk-dice-result__total')).toBeNull();

    const withTotal = render([{ sides: 20, value: 11, kept: true }], 2, 13);
    expect(withTotal.querySelector('.hk-dice-result__total')?.textContent?.trim()).toBe('= 13');
  });
});
