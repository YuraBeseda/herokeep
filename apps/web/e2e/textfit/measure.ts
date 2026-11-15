import type { Page } from '@playwright/test';

/**
 * The two text-fit assertions, evaluated in the page: (1) the document does not scroll sideways;
 * (2) no element that clips (`overflow` hidden/clip) has content wider than its box, unless it carries
 * `data-truncate` AND the hint behind it carries the full text (`hkTooltip` hosts have an
 * `aria-describedby="hk-tip-…"`; focusing the host shows the slip, which is read, then blurred).
 * Returns one line per violation.
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
    const name = (el: HTMLElement): string =>
      `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`;
    const words = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const clips = ['hidden', 'clip'].includes(getComputedStyle(el).overflowX);
      if (!clips || el.clientWidth <= 1 || el.scrollWidth <= el.clientWidth) continue;
      if (!el.hasAttribute('data-truncate')) {
        found.push(
          `${name(el)} clips: ${el.scrollWidth} > ${el.clientWidth} "${words(el.textContent).slice(0, 40)}"`,
        );
        continue;
      }
      const host = el.closest<HTMLElement>('[aria-describedby*="hk-tip-"]');
      if (!host) {
        found.push(
          `${name(el)} is data-truncate with no tooltip: "${words(el.textContent).slice(0, 40)}"`,
        );
        continue;
      }
      host.dispatchEvent(new Event('focus'));
      const tipId = (host.getAttribute('aria-describedby') ?? '').split(' ').pop() ?? '';
      const tip = words(document.getElementById(tipId)?.textContent ?? '');
      host.dispatchEvent(new Event('blur'));
      if (!tip.includes(words(el.textContent))) {
        found.push(
          `${name(el)} tooltip lacks the full text: "${tip.slice(0, 40)}" vs "${words(el.textContent).slice(0, 40)}"`,
        );
      }
    }
    return found;
  });
}
