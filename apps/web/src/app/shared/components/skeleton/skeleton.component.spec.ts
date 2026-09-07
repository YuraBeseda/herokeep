import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SkeletonComponent } from './skeleton.component';

@Component({
  selector: 'app-skeleton-host',
  imports: [SkeletonComponent],
  template: `<hk-skeleton [lines]="lines()" [width]="width()" />`,
})
class HostComponent {
  readonly lines = signal(1);
  readonly width = signal<string | undefined>(undefined);
}

describe('SkeletonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('renders one bar by default', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.hk-skeleton__bar').length).toBe(1);
  });

  it('renders `lines` bars', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.lines.set(3);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.hk-skeleton__bar').length).toBe(3);
  });

  it('is aria-hidden', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const host = compiled.querySelector('hk-skeleton')!;
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies width to each bar when provided', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.width.set('60%');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const bar = compiled.querySelector<HTMLElement>('.hk-skeleton__bar')!;
    expect(bar.style.width).toBe('60%');
  });
});
