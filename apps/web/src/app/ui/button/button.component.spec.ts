import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HkButtonComponent } from './button.component';

@Component({
  selector: 'app-button-host',
  imports: [HkButtonComponent],
  template: `
    <button
      hk-button
      [variant]="variant()"
      [loading]="loading()"
      [disabledReason]="reason()"
      (click)="clicks = clicks + 1"
    >
      {{ label }}
    </button>
  `,
})
class HostComponent {
  readonly variant = signal<'primary' | 'parchment' | 'ghost' | 'ember'>('primary');
  readonly loading = signal(false);
  readonly reason = signal<string | null>(null);
  readonly label = 'Roll';
  clicks = 0;
}

describe('HkButtonComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
  });

  afterEach(() => fixture.destroy());

  it('is a pill button with the primary finish by default and projects its label', () => {
    expect(button.classList.contains('hk-button')).toBe(true);
    expect(button.classList.contains('hk-button--primary')).toBe(true);
    expect(button.textContent?.trim()).toBe('Roll');
    expect(button.getAttribute('type')).toBe('button');
  });

  it.each(['parchment', 'ghost', 'ember'] as const)('exposes the %s variant', async (variant) => {
    fixture.componentInstance.variant.set(variant);
    await fixture.whenStable();
    expect(button.classList.contains(`hk-button--${variant}`)).toBe(true);
  });

  it('loading sets aria-busy, shows a spinner and swallows clicks', async () => {
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.classList.contains('hk-button--loading')).toBe(true);
    expect(button.querySelector('.hk-button__spinner')).not.toBeNull();
    button.click();
    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('a disabled reason is described, never written next to the button', async () => {
    fixture.componentInstance.reason.set('No free cast left until a long rest');
    await fixture.whenStable();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Visible text is still only the label.
    const visible = button.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('[hidden]').forEach((node) => node.remove());
    expect(visible.textContent?.trim()).toBe('Roll');
    // The description target exists, is hidden, and aria-describedby points at it.
    const target = button.querySelector<HTMLElement>('.hk-button__reason')!;
    expect(target.hidden).toBe(true);
    expect(target.textContent).toBe('No free cast left until a long rest');
    expect(button.getAttribute('aria-describedby')!.split(' ')).toContain(target.id);
  });

  it('a disabled reason blocks activation but stays focusable for its hint', async () => {
    fixture.componentInstance.reason.set('Nope');
    await fixture.whenStable();
    button.click();
    expect(fixture.componentInstance.clicks).toBe(0);
    expect(button.disabled).toBe(false);
    fixture.componentInstance.reason.set(null);
    await fixture.whenStable();
    button.click();
    expect(fixture.componentInstance.clicks).toBe(1);
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('shows the reason as a tooltip on focus', async () => {
    fixture.componentInstance.reason.set('Nope');
    await fixture.whenStable();
    button.dispatchEvent(new Event('focus'));
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Nope');
    button.dispatchEvent(new Event('blur'));
  });
});
