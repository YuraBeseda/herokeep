import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HkTooltipDirective } from './tooltip.directive';

@Component({
  selector: 'app-tooltip-host',
  imports: [HkTooltipDirective],
  template: `<button type="button" [hkTooltip]="text()" [hkTooltipDelay]="delay()">
    {{ glyph }}
  </button>`,
})
class HostComponent {
  readonly text = signal('Roll the dice');
  readonly delay = signal(300);
  protected readonly glyph = 'x';
}

function tip(): HTMLElement | null {
  return document.body.querySelector('[role="tooltip"]');
}

function pointer(el: HTMLElement, type: string, pointerType: string): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  el.dispatchEvent(event);
}

describe('HkTooltipDirective', () => {
  let button: HTMLButtonElement;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  it('shows the hint 300 ms after mouseenter, not before', () => {
    button.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(299);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tip()?.textContent).toContain('Roll the dice');
  });

  it('references the slip with aria-describedby only while it is shown', () => {
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    button.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(button.getAttribute('aria-describedby')).toBe(tip()!.id);
    button.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('honours a custom hkTooltipDelay', () => {
    fixture.componentInstance.delay.set(50);
    fixture.detectChanges();
    button.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(50);
    expect(tip()).not.toBeNull();
  });

  it('shows immediately on focus and hides on blur', () => {
    button.dispatchEvent(new Event('focus'));
    expect(tip()).not.toBeNull();
    button.dispatchEvent(new Event('blur'));
    expect(tip()).toBeNull();
  });

  it('shows after a 400 ms touch pointerdown and not for a shorter press', () => {
    pointer(button, 'pointerdown', 'touch');
    vi.advanceTimersByTime(399);
    expect(tip()).toBeNull();
    pointer(button, 'pointerup', 'touch');
    vi.advanceTimersByTime(10);
    expect(tip()).toBeNull();

    pointer(button, 'pointerdown', 'touch');
    vi.advanceTimersByTime(400);
    expect(tip()).not.toBeNull();
  });

  it('does not start the long-press timer for a mouse pointerdown', () => {
    pointer(button, 'pointerdown', 'mouse');
    vi.advanceTimersByTime(500);
    expect(tip()).toBeNull();
  });

  it('is removed on mouseleave', () => {
    button.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(300);
    button.dispatchEvent(new Event('mouseleave'));
    expect(tip()).toBeNull();
  });

  it('cancels a pending show on mouseleave', () => {
    button.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(100);
    button.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(500);
    expect(tip()).toBeNull();
  });

  it('is removed by Escape, even without focus on the anchor', () => {
    button.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()).toBeNull();
  });

  it('links the host to the tooltip with aria-describedby', () => {
    button.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    const id = button.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(tip()?.id).toBe(id);
  });

  it('gives every anchor its own id', () => {
    const second = TestBed.createComponent(HostComponent);
    second.detectChanges();
    const other = (second.nativeElement as HTMLElement).querySelector('button')!;
    button.dispatchEvent(new Event('focus'));
    other.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    second.detectChanges();
    expect(other.getAttribute('aria-describedby')).not.toBe(
      button.getAttribute('aria-describedby'),
    );
    second.destroy();
  });

  it('never shows an empty hint', () => {
    fixture.componentInstance.text.set('');
    fixture.detectChanges();
    button.dispatchEvent(new Event('focus'));
    expect(tip()).toBeNull();
  });

  it('removes the tooltip when the anchor is destroyed', () => {
    button.dispatchEvent(new Event('focus'));
    fixture.destroy();
    expect(tip()).toBeNull();
  });
});
