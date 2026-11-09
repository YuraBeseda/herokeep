/**
 * Wraps a "leave without saving?" prompt so asking twice while the first prompt is still open
 * returns the SAME answer instead of stacking a second dialog (a double Cancel, or Cancel then a tab
 * click). Once the prompt settles, the next call asks again. Create one per component instance.
 */
export function askOnce(ask: () => Promise<boolean>): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null;
  return () => {
    pending ??= ask().finally(() => {
      pending = null;
    });
    return pending;
  };
}
