import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HpBarComponent } from './hp-bar.component';

@Component({
  selector: 'app-hp-bar-host',
  imports: [HpBarComponent],
  template: `<hk-hp-bar [current]="current()" [max]="max()" [temp]="temp()" />`,
})
class HostComponent {
  readonly current = signal(0);
  readonly max = signal(0);
  readonly temp = signal(0);
}

describe('HpBarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('fills the track to current/max and offsets the temp overlay to start where the fill ends', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(6);
    fixture.componentInstance.max.set(12);
    fixture.componentInstance.temp.set(3);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    expect(fill.style.width).toBe('50%');
    expect(temp.style.left).toBe('50%');
    expect(temp.style.width).toBe('25%');
  });

  it('clamps a current above max to a full 100% fill', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(15);
    fixture.componentInstance.max.set(12);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    expect(fill.style.width).toBe('100%');
  });

  // Fix-round-1 (code review): at full HP, `currentPct` used to clamp to 100 against a `max`-only
  // base, pushing the temp segment to `left: 100%` where the track's `overflow: hidden` clipped it
  // entirely — temp HP from False Life/Aid was invisible exactly when a full-HP character gained
  // it. The percentage base now widens to `current + temp` whenever that exceeds `max`, so the
  // fill+temp segments always share the full track instead of temp spilling off the end.
  it('at full HP (current === max), temp HP still renders as a visible, nonzero-width overlay', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(12);
    fixture.componentInstance.max.set(12);
    fixture.componentInstance.temp.set(3);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    // Base widens to current+temp (15) since it exceeds max (12): fill 12/15 = 80%, temp 3/15 =
    // 20%, positioned right after the fill — together they exactly fill the track, none clipped.
    expect(fill.style.width).toBe('80%');
    expect(temp.style.left).toBe('80%');
    expect(temp.style.width).toBe('20%');
    expect(temp.style.width).not.toBe('0%');
  });

  it('renders an empty track (0% fill, 0% temp) when max, current and temp are all 0, never dividing by zero', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(0);
    fixture.componentInstance.max.set(0);
    fixture.componentInstance.temp.set(0);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    expect(fill.style.width).toBe('0%');
    expect(temp.style.width).toBe('0%');
  });

  it('still shows temp HP (100% width) when max is 0 but temp is not — the widened base covers this degenerate case too', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(0);
    fixture.componentInstance.max.set(0);
    fixture.componentInstance.temp.set(5);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    expect(fill.style.width).toBe('0%');
    expect(temp.style.width).toBe('100%');
  });

  it('defaults temp to 0 (a 0%-width overlay) when omitted', async () => {
    @Component({
      selector: 'app-hp-bar-no-temp-host',
      imports: [HpBarComponent],
      template: `<hk-hp-bar [current]="6" [max]="12" />`,
    })
    class NoTempHostComponent {}

    await TestBed.configureTestingModule({ imports: [NoTempHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(NoTempHostComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    expect(temp.style.width).toBe('0%');
  });

  it('is aria-hidden (the numeric values are rendered elsewhere as accessible text)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const host = compiled.querySelector('hk-hp-bar')!;
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });
});
