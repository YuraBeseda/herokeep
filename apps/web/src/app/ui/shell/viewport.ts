import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/** Below this width the shell is the phone layout (top bar, drawer, bottom tabs, strap tiles). */
export const PHONE_QUERY = '(max-width: 767.98px)';

/**
 * Whether the viewport is phone-width (< 768 px), kept live. Call in an injection context. Layout
 * differences that only CSS needs stay in CSS; this is for the places where a different DOM is
 * rendered (a different landmark, a More button instead of icon buttons). `media` overrides the query.
 */
export function phoneLayout(media = PHONE_QUERY): Signal<boolean> {
  const query = typeof matchMedia === 'function' ? matchMedia(media) : null;
  const phone = signal(query?.matches ?? false);
  if (query) {
    const onChange = (event: MediaQueryListEvent): void => phone.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
  return phone.asReadonly();
}
