import { expect, test } from '@playwright/test';
import { measureOverflow } from './measure';

// The harness's own proof: it must catch a 600 px unbreakable string both ways, and stay quiet on a
// wrapping layout and on a `data-truncate` ellipsis.
const LONG = 'W'.repeat(80); // ~600+ px at 16 px, no break opportunity

test('flags a sideways-scrolling document and a clipping element', async ({ page }) => {
  await page.setContent(
    `<div id="clip" style="overflow:hidden;width:100px"><span style="white-space:nowrap">${LONG}</span></div>
     <p style="white-space:nowrap;font:16px monospace">${LONG}${LONG}</p>`,
  );
  const found = await measureOverflow(page);
  expect(found.some((line) => line.startsWith('document scrolls sideways'))).toBe(true);
  expect(found.some((line) => line.includes('clips'))).toBe(true);
});

test('accepts wrapping text and a data-truncate ellipsis', async ({ page }) => {
  await page.setContent(
    `<p style="overflow-wrap:anywhere">${LONG}</p>
     <div data-truncate style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100px">${LONG}</div>`,
  );
  expect(await measureOverflow(page)).toEqual([]);
});
