import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HkFitLabelDirective } from './fit-label.directive';

@Component({
  imports: [HkFitLabelDirective],
  template: `<button hkFitLabel><span data-fit-label [textContent]="'Long label'"></span></button>`,
})
class HostComponent {}

/** jsdom has no layout, so the widths are stated: the tile is `tile` px wide, the label wants `label`. */
function setup(tile: number, label: number): { button: HTMLElement; refit: () => void } {
  const fixture = TestBed.createComponent(HostComponent);
  const root = fixture.nativeElement as HTMLElement;
  const button = root.querySelector<HTMLElement>('button')!;
  const span = root.querySelector<HTMLElement>('[data-fit-label]')!;
  Object.defineProperty(button, 'clientWidth', { configurable: true, get: () => tile });
  Object.defineProperty(span, 'scrollWidth', { configurable: true, get: () => label });
  fixture.detectChanges();
  const directive = fixture.debugElement.children[0].injector.get(HkFitLabelDirective);
  return { button, refit: () => directive.refit() };
}

describe('HkFitLabelDirective', () => {
  it('keeps the label when it fits', () => {
    const { button, refit } = setup(100, 90);
    refit();
    expect(button.classList.contains('hk-fit-label--icon-only')).toBe(false);
  });

  it('drops to icon-only when the label does not fit, and comes back when it does', () => {
    const { button, refit } = setup(60, 90);
    refit();
    expect(button.classList.contains('hk-fit-label--icon-only')).toBe(true);
    Object.defineProperty(button, 'clientWidth', { configurable: true, get: () => 120 });
    refit();
    expect(button.classList.contains('hk-fit-label--icon-only')).toBe(false);
  });
});
