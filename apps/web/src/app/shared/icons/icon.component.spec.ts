import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-icon-host',
  imports: [IconComponent],
  template: `<hk-icon [icon]="icon()" />`,
})
class HostComponent {
  readonly icon = signal('gi:crossed-swords');
}

describe('IconComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('renders a <use> pointing at the sprite symbol for the given slug', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const use = compiled.querySelector('svg.hk-icon use')!;
    expect(use.getAttribute('href')).toBe('assets/icons/sprite.svg#gi-crossed-swords');
  });

  it('marks the svg aria-hidden', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const svg = compiled.querySelector('svg.hk-icon')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('updates the href when the icon input changes', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.icon.set('gi:shield');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const use = compiled.querySelector('svg.hk-icon use')!;
    expect(use.getAttribute('href')).toBe('assets/icons/sprite.svg#gi-shield');
  });

  it('throws a clear error when icon is missing the gi: prefix', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.icon.set('crossed-swords');
    expect(() => fixture.detectChanges()).toThrow(/gi:/);
  });
});
