/**
 * Keeps a hover popover open while the pointer crosses the gap between its host and the panel:
 * leaving the host (or the panel) defers `close` by `graceMs`; entering the host or the panel
 * cancels it. Returns a cleanup that removes every listener and the pending timer.
 */
export function hoverBridge(
  host: HTMLElement,
  panel: () => HTMLElement | null,
  close: () => void,
  graceMs = 150,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bound: HTMLElement | null = null;

  const cancel = (): void => clearTimeout(timer);
  const arm = (): void => {
    cancel();
    timer = setTimeout(close, graceMs);
  };
  const unbind = (): void => {
    bound?.removeEventListener('mouseenter', cancel);
    bound?.removeEventListener('mouseleave', arm);
    bound = null;
  };
  const onHostLeave = (): void => {
    // The panel exists only while open, so it is bound when the pointer first leaves the host.
    const el = panel();
    if (el !== bound) {
      unbind();
      bound = el;
      el?.addEventListener('mouseenter', cancel);
      el?.addEventListener('mouseleave', arm);
    }
    arm();
  };

  host.addEventListener('mouseenter', cancel);
  host.addEventListener('mouseleave', onHostLeave);
  return () => {
    cancel();
    unbind();
    host.removeEventListener('mouseenter', cancel);
    host.removeEventListener('mouseleave', onHostLeave);
  };
}
