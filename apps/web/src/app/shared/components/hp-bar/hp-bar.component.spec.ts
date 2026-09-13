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

  it('renders an empty track (0% fill, 0% temp) when max is 0, never dividing by zero', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.current.set(0);
    fixture.componentInstance.max.set(0);
    fixture.componentInstance.temp.set(5);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector<HTMLElement>('.hk-hp-bar__fill')!;
    const temp = compiled.querySelector<HTMLElement>('.hk-hp-bar__temp')!;
    expect(fill.style.width).toBe('0%');
    expect(temp.style.width).toBe('0%');
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
