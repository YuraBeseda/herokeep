import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { expect, test } from '@playwright/test';

// Angular's service worker doesn't cache its prefetched resources synchronously during
// `install`/`activate` — `AppVersion.initializeFully()` (which actually downloads and caches
// every `installMode: "prefetch"` assetGroup, i.e. app/assets/core-pack in ngsw-config.json) runs
// as a *background idle task*: scheduled once the driver is set up, then run after the SW has
// been quiet for 5s, or after 30s no matter what (`IDLE_DELAY`/`MAX_IDLE_DELAY` in
// `@angular/service-worker/ngsw-worker.js`). `/ngsw/state`'s "Driver state: NORMAL" line (the
// pattern angular.dev's devtools docs show) only means the manifest is valid — it says nothing
// about whether that background caching has actually finished, so this bounds waiting for the
// real, functional signal instead (see the "wait for..." step below).
const NGSW_IDLE_TIMEOUT = 45_000;
const CORE_PACK_URL = `/packs/${PACK_ID}/${PACK_VERSION}/pack.json`;

test.describe('offline', () => {
  // Loads `/`, waits for the service worker to take control of the page and finish caching the
  // app shell and the core pack, then goes offline and reloads: the app shell, the library list,
  // and a spell detail must all still render from the service worker's cache.
  test('the library and a spell detail still render after going offline', async ({
    page,
    context,
  }) => {
    await test.step('load "/" and wait for the service worker to take control', async () => {
      await page.goto('/');
      // Angular's ngsw-worker.js calls `skipWaiting()` on install and `clients.claim()` on
      // activate — it takes control of the very page that registered it as soon as it activates.
      // No reload is needed for that.
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: NGSW_IDLE_TIMEOUT,
      });
    });

    await test.step('wait for the app shell and the core pack to actually be cached', async () => {
      // The direct, functional check (as opposed to `/ngsw/state`'s text — see the module doc
      // above): ask Cache Storage itself whether the resources this test depends on are there.
      await expect
        .poll(
          () =>
            page.evaluate(async (packUrl) => {
              const [index, pack] = await Promise.all([
                caches.match('/index.html'),
                caches.match(packUrl),
              ]);
              return index !== undefined && pack !== undefined;
            }, CORE_PACK_URL),
          { timeout: NGSW_IDLE_TIMEOUT },
        )
        .toBe(true);
    });

    await test.step('go offline and reload — the app shell still boots from cache', async () => {
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
    });

    await test.step('the library still renders rows offline (the core pack is SW-cached)', async () => {
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await expect(page.locator('.library-browse__row').first()).toBeVisible();
    });

    await test.step('a spell detail still opens offline', async () => {
      await page.locator('.library-browse__row').first().click();
      await expect(page.locator('.library-detail__name')).toBeVisible();
      await expect(page.locator('.library-detail__description-body')).toBeVisible();
    });
  });
});
