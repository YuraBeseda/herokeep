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

// A fake `hkTooltip`: on `focus` a `role=tooltip` slip appears holding `text` (what the real directive does; see tooltip.directive.ts).
const tipHost = (text: string, inner: string): string =>
  `<div id="host" aria-describedby="hk-tip-t"><div data-truncate style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100px">${inner}</div></div>
   <script>document.getElementById('host').addEventListener('focus',()=>{const t=document.createElement('div');t.id='hk-tip-t';t.setAttribute('role','tooltip');t.textContent=${JSON.stringify(text)};document.body.append(t)});
   document.getElementById('host').addEventListener('blur',()=>document.getElementById('hk-tip-t')?.remove());</script>`;

test('accepts wrapping text and a data-truncate ellipsis that has its tooltip', async ({
  page,
}) => {
  await page.setContent(`<p style="overflow-wrap:anywhere">${LONG}</p>${tipHost(LONG, LONG)}`);
  expect(await measureOverflow(page)).toEqual([]);
});

test('flags a data-truncate ellipsis with no tooltip, or one that lacks the full text', async ({
  page,
}) => {
  await page.setContent(
    `<div data-truncate style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100px">${LONG}</div>`,
  );
  expect((await measureOverflow(page)).some((line) => line.includes('no tooltip'))).toBe(true);
  await page.setContent(tipHost('short', LONG));
  expect((await measureOverflow(page)).some((line) => line.includes('tooltip lacks'))).toBe(true);
});
