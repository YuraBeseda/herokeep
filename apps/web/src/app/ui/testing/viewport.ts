import { vi } from 'vitest';

/** Stubs `matchMedia` so a spec can pick the phone or tablet/desktop layout. Undo with `vi.unstubAllGlobals()`. */
export function stubViewport(opts: { phone?: boolean; coarse?: boolean } = {}): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query.includes('max-width')
      ? !!opts.phone
      : query.includes('coarse')
        ? !!opts.coarse
        : false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
