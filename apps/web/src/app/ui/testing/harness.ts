import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from './transloco-testing';

/** Mounts a `ui/` component with the real `shell` bundles and the given inputs. */
export async function mount<T>(type: Type<T>, inputs: Record<string, unknown>) {
  // A spec may mount twice to compare two states; the first fixture is read before the second.
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(type);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** The hint slip text an element shows on keyboard focus (`null` when it shows none). */
export function hintOf(anchor: Element): string | null {
  anchor.dispatchEvent(new Event('focus'));
  const text = document.body.querySelector('[role="tooltip"]')?.textContent?.trim() ?? null;
  anchor.dispatchEvent(new Event('blur'));
  return text;
}

/** The accessible name a control carries, from `aria-label`. */
export function nameOf(el: Element | null): string | null {
  return el?.getAttribute('aria-label') ?? null;
}

/** The accessible name of a control: `aria-labelledby` targets (joined) win over `aria-label`. */
export function accessibleName(el: Element): string | null {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => {
        const target = el.ownerDocument.getElementById(id);
        return target ? (target.getAttribute('aria-label') ?? target.textContent?.trim()) : '';
      })
      .join(' ')
      .trim();
  }
  return el.getAttribute('aria-label');
}

/**
 * A real pointer click, the way a mouse or finger produces it: hover, press, release, click.
 * A bare `el.click()` skips the events a hint or popover listens to and hides ordering bugs.
 */
export function press(el: Element, pointerType: 'mouse' | 'touch' = 'mouse'): void {
  const pointer = (type: string): Event => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
  };
  if (pointerType === 'mouse') el.dispatchEvent(new Event('mouseenter'));
  el.dispatchEvent(pointer('pointerdown'));
  el.dispatchEvent(pointer('pointerup'));
  (el as HTMLElement).click();
}

/** Types `text` into an input the way the browser reports it: set the value, fire `input`. */
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
