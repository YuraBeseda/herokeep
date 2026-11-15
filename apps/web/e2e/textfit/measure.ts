import type { Page } from '@playwright/test';

/**
 * The two text-fit assertions, evaluated in the page: (1) the document does not scroll sideways;
 * (2) no element that clips (`overflow` hidden/clip) has content wider than its box, unless it carries
 * `data-truncate` (an ellipsis with a tooltip holding the full text). Returns one line per violation.
 */
export async function measureOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      // Name the culprits: the widest elements poking past the right edge.
      const past = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
        .map(
          (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`,
        )
        .slice(0, 4);
      found.push(
        `document scrolls sideways: ${root.scrollWidth} > ${root.clientWidth} (${past.join(', ')})`,
      );
    }
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      const clips = ['hidden', 'clip'].includes(style.overflowX);
      if (!clips || el.hasAttribute('data-truncate') || el.clientWidth <= 1) continue;
      if (el.scrollWidth > el.clientWidth) {
        const label = `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`;
        found.push(
          `${label} clips: ${el.scrollWidth} > ${el.clientWidth} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
        );
      }
    }
    return found;
  });
}
