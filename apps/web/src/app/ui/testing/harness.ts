import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from './transloco-testing';

/** Mounts a `ui/` component with the real `shell` bundles and the given inputs. */
export async function mount<T>(type: Type<T>, inputs: Record<string, unknown>) {
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
