import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconButtonComponent } from './icon-button.component';

@Component({
  selector: 'app-icon-button-host',
  imports: [IconButtonComponent],
  template: `
    <button hk-icon-button [icon]="icon()" [label]="label()" [variant]="variant()">
      {{ label() }}
    </button>
  `,
})
class HostComponent {
  readonly icon = signal('gi:crossed-swords');
  readonly label = signal('Attack');
  readonly variant = signal<'primary' | 'ghost' | 'danger'>('primary');
}

describe('IconButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('renders the required label as aria-label', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Attack');
  });

  it('exposes the icon input as a data-icon attribute', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.getAttribute('data-icon')).toBe('gi:crossed-swords');
  });

  it('updates aria-label and data-icon when the inputs change', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.label.set('Defend');
    fixture.componentInstance.icon.set('gi:shield');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Defend');
    expect(button.getAttribute('data-icon')).toBe('gi:shield');
  });

  it('reflects variant as a host class, defaulting to primary', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.classList.contains('hk-icon-button--primary')).toBe(true);

    fixture.componentInstance.variant.set('danger');
    await fixture.whenStable();
    expect(button.classList.contains('hk-icon-button--danger')).toBe(true);
    expect(button.classList.contains('hk-icon-button--primary')).toBe(false);
  });
});
