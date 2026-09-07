import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-button-host',
  imports: [ButtonComponent],
  template: `
    <button hk-button [variant]="variant()" [disabled]="disabled()" (click)="onClick()">
      {{ label() }}
    </button>
  `,
})
class HostComponent {
  readonly variant = signal<'primary' | 'ghost' | 'danger'>('primary');
  readonly disabled = signal(false);
  readonly label = signal('Label');
  clicks = 0;

  onClick(): void {
    this.clicks++;
  }
}

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('defaults to the primary variant class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.classList.contains('hk-button--primary')).toBe(true);
    expect(button.classList.contains('hk-button--ghost')).toBe(false);
    expect(button.classList.contains('hk-button--danger')).toBe(false);
  });

  it('reflects the ghost variant as a host class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.variant.set('ghost');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.classList.contains('hk-button--ghost')).toBe(true);
    expect(button.classList.contains('hk-button--primary')).toBe(false);
  });

  it('reflects the danger variant as a host class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.variant.set('danger');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;
    expect(button.classList.contains('hk-button--danger')).toBe(true);
  });

  it('sets aria-disabled and blocks the click handler when disabled', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.disabled.set(true);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;

    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(true);

    button.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('does not set aria-disabled and allows clicks when enabled', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button')!;

    expect(button.getAttribute('aria-disabled')).toBeNull();

    button.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.clicks).toBe(1);
  });
});
