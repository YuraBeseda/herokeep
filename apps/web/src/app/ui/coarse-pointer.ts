import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/**
 * Whether the primary pointer is coarse (touch), kept live. Call in an injection context. Used to
 * pick the 44px `phone` size of a design-system button where plain CSS cannot reach into it.
 */
export function coarsePointer(): Signal<boolean> {
  const coarse = signal(
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );
  if (typeof matchMedia === 'function') {
    const query = matchMedia('(pointer: coarse)');
    const onChange = (event: MediaQueryListEvent): void => coarse.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
  return coarse.asReadonly();
}
