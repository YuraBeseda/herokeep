import { mount } from '../testing/harness';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkPoolBarComponent } from './pool-bar.component';

@Component({
  selector: 'app-pool-host',
  imports: [HkPoolBarComponent],
  template: `
    <hk-pool-bar
      [kind]="kind()"
      [value]="value()"
      [max]="max()"
      [label]="'Lay on Hands'"
      [glyph]="'gi:healing'"
      [unit]="'points'"
      [recharge]="'long rest'"
      [rechargeGlyph]="'gi:night-sleep'"
      [pipHint]="'Charge'"
    >
      <button hkPoolAction type="button" id="spend">{{ action }}</button>
    </hk-pool-bar>
  `,
})
class HostComponent {
  readonly action = 'Spend';
  readonly kind = signal<'points' | 'pips'>('points');
  readonly value = signal(18);
  readonly max = signal(25);
}

describe('HkPoolBarComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideShellTransloco()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => fixture.destroy());

  it('names the resource and projects its action button', () => {
    expect(el.querySelector('.hk-pool-bar__name')!.textContent?.trim()).toBe('Lay on Hands');
    expect(el.querySelector('.hk-pool-bar__head #spend')).not.toBeNull();
    expect(el.querySelector('.hk-pool-bar__ring hk-icon use')!.getAttribute('href')).toBe(
      'assets/icons/sprite.svg#gi-healing',
    );
  });

  it('draws a brass gauge for a point pool, as an image with the count in words', () => {
    const gauge = el.querySelector('[role="img"].hk-gauge')!;
    expect(gauge.getAttribute('aria-label')).toBe('Lay on Hands: 18 of 25');
    expect(el.querySelector<HTMLElement>('.hk-gauge__brass')!.style.width).toBe('72%');
    expect(el.querySelector('hk-wax-seal')).toBeNull();
  });

  it('shows the count, its unit and the recharge hint with its glyph', () => {
    expect(el.querySelector('.hk-pool-bar__count')!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '18 / 25 points',
    );
    const recharge = el.querySelector('.hk-pool-bar__recharge')!;
    expect(recharge.textContent?.trim()).toBe('long rest');
    expect(recharge.querySelector('hk-icon use')!.getAttribute('href')).toBe(
      'assets/icons/sprite.svg#gi-night-sleep',
    );
  });

  it('draws wax-seal pips for uses and charges: filled while available, spent after', async () => {
    fixture.componentInstance.kind.set('pips');
    fixture.componentInstance.value.set(2);
    fixture.componentInstance.max.set(4);
    await fixture.whenStable();
    const group = el.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Lay on Hands: 2 of 4');
    const seals = Array.from(group.querySelectorAll('hk-wax-seal'));
    expect(seals.map((s) => s.classList.contains('hk-wax-seal--spent'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Every pip carries the caller's hint; four or fewer pips are size m, five or more size s.
    expect(seals[0].querySelector('svg')!.getAttribute('aria-label')).toBe('Charge');
    expect(seals.every((s) => s.classList.contains('hk-wax-seal--m'))).toBe(true);
    fixture.componentInstance.max.set(6);
    await fixture.whenStable();
    expect(el.querySelector('hk-wax-seal')!.classList.contains('hk-wax-seal--s')).toBe(true);
  });

  it('clamps an out-of-range value', async () => {
    fixture.componentInstance.value.set(40);
    await fixture.whenStable();
    expect(el.querySelector<HTMLElement>('.hk-gauge__brass')!.style.width).toBe('100%');
  });

  it('never shows a negative count for a negative max or value', async () => {
    fixture.componentInstance.max.set(-3);
    await fixture.whenStable();
    expect(el.querySelector('.hk-pool-bar__count')!.textContent).toMatch(/^\s*0 \//);
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
      'Lay on Hands: 0 of -3',
    );
    expect(el.querySelector<HTMLElement>('.hk-gauge__brass')!.style.width).toBe('0%');
    fixture.componentInstance.max.set(5);
    fixture.componentInstance.value.set(-2);
    await fixture.whenStable();
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
      'Lay on Hands: 0 of 5',
    );
  });
});

describe('HkPoolBarComponent breakdown control', () => {
  it('names the inspectable maximum by resource, count and "show breakdown"', async () => {
    const { el } = await mount(HkPoolBarComponent, {
      kind: 'points',
      value: 3,
      max: 5,
      label: 'Lay on Hands',
      inspectable: true,
    });
    const count = el.querySelector('.hk-pool-bar__count')!;
    expect(count.getAttribute('role')).toBe('button');
    expect(count.getAttribute('aria-label')).toBe('Lay on Hands 3 / 5, show breakdown');
  });
});
