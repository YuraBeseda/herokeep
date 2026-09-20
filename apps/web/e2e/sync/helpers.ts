import { expect, type Page } from '@playwright/test';

/**
 * Shared plumbing for the `sync` e2e project's real-API scenarios (task-11-brief.md). Unlike
 * `../helpers/create-fighter.ts` (reused here unchanged for character creation itself), these
 * drive the auth screens (`views/auth/{login,register}`) against the REAL Node API adapter this
 * project's `playwright.sync.config.ts` boots — register really derives a PBKDF2 verifier in the
 * browser (ADR-012, ~1-2s) and really POSTs it, so every helper below waits on the real
 * network-driven UI state (an enabled submit button, a URL change) rather than a fixed delay.
 */

/** ADR-012's password rules (`password-check.ts`): >= 10 chars, not in the bundled top-10k common
 * list, and must not contain the username. Fixed and reused across every test in this project —
 * `checkPassword` has no per-account uniqueness requirement, only per-password shape ones, so one
 * constant satisfying all of them is enough; `uniqueUsername` below is what keeps ACCOUNTS apart. */
export const TEST_PASSWORD = 'Zq7#Vwrmpl-Keep92xT';

let usernameCounter = 0;

/** A fresh, `USERNAME_PATTERN`-valid username per call (3-32 `[\p{L}\p{N}_-]`). This project runs
 * `workers: 1` (one test at a time), so a per-process counter alongside a timestamp is enough to
 * never collide across the tests in one run — `start-e2e-api.mjs` also gives every RUN of the
 * suite its own fresh temp data dir, so there is no cross-run collision risk either. */
export function uniqueUsername(prefix: string): string {
  usernameCounter += 1;
  return `${prefix}${Date.now().toString(36)}${usernameCounter}`.toLowerCase().slice(0, 32);
}

/** Drives `/register`'s form step to completion and returns the 6 recovery codes shown on the
 * codes step — does NOT confirm/continue past it (see `confirmRecoveryCodesAndContinue`), so a
 * caller that wants to assert on the codes step itself (count, content) can do so first. */
export async function registerToCodesStep(
  page: Page,
  username: string,
  deviceLabel: string,
): Promise<string[]> {
  await page.goto('/register');
  await page.locator('.register__form input[name="username"]').fill(username);
  await page.locator('.register__form input[name="password"]').fill(TEST_PASSWORD);
  await page.locator('.register__form input[name="deviceLabel"]').fill(deviceLabel);

  const submit = page.locator('.register__submit');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.locator('.register__codes')).toBeVisible();
  const codes = await page.locator('.register__code').allTextContents();
  expect(codes).toHaveLength(6);
  return codes;
}

/** Ticks the "I saved my codes" checkbox and continues past the codes step to `/characters` —
 * the second half of a full register flow, split from `registerToCodesStep` so callers can assert
 * on the codes step itself first. */
export async function confirmRecoveryCodesAndContinue(page: Page): Promise<void> {
  await page.locator('.register__confirm-field input[type="checkbox"]').check();
  await page.locator('.register__continue').click();
  await expect(page).toHaveURL(/\/characters$/);
}

/** Full register round trip: form -> codes step (asserts 6 codes + confirms) -> `/characters`. */
export async function registerAndContinue(
  page: Page,
  username: string,
  deviceLabel: string,
): Promise<string[]> {
  const codes = await registerToCodesStep(page, username, deviceLabel);
  await confirmRecoveryCodesAndContinue(page);
  return codes;
}

/** Drives `/login` to completion, landing on `/characters`. */
export async function loginAndContinue(
  page: Page,
  username: string,
  deviceLabel: string,
): Promise<void> {
  await page.goto('/login');
  await page.locator('.login__form input[name="username"]').fill(username);
  await page.locator('.login__form input[name="password"]').fill(TEST_PASSWORD);
  await page.locator('.login__form input[name="deviceLabel"]').fill(deviceLabel);
  await page.locator('.login__submit').click();
  await expect(page).toHaveURL(/\/characters$/);
}

/** Polls for a `/characters` list row named `name` to exist, RE-NAVIGATING (a full `page.goto`,
 * not a single wait) on every attempt until it shows up or `timeoutMs` elapses.
 *
 * `characters-list.component.ts`'s `charactersResource` is a ONE-SHOT `resource()` — reloaded
 * only on an explicit user mutation (import/delete's own `.reload()` calls), never reactively
 * when `SyncService`'s background restore-on-new-device flow (`sync.service.ts`'s `restore()`)
 * writes a newly-restored character into `CharactersRepository`/Dexie out from under it. A single
 * navigation to `/characters` right after login can therefore load the list BEFORE that restore
 * has finished (restore runs independently, kicked off by the same auth-status effect, with no
 * ordering guarantee against the list component's own mount) — and, once that one-shot resource
 * has resolved empty, nothing on that page ever re-queries it, so waiting longer on the SAME
 * loaded page can never help (confirmed the hard way: an earlier version of this helper hung for
 * a full 60s test timeout on exactly this). A FRESH `page.goto` is what forces a fresh resource
 * load against whatever Dexie holds at that moment, so this polls by repeatedly reloading — the
 * same "the user refreshes" recovery an actual person would reach for, not a weakened assertion:
 * the end condition (the row exists, with the right name) is exactly as strict either way. */
export async function waitForCharacterInList(
  page: Page,
  name: string,
  // 45s: generous margin over the couple of seconds restore normally takes (observed: under 2s
  // once the server is warm) — the API adapter's FIRST few requests right after its own process
  // boot (SQLite WAL file creation, better-sqlite3's native binding first touch, V8 JIT warmup)
  // can be measurably slower than steady-state, and this helper is what the very first sync
  // scenario in a run exercises right after `playwright.sync.config.ts`'s webServer entries
  // report ready.
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.goto('/characters');
    const row = page.locator('.characters-list__item', { hasText: name });
    if (await row.isVisible().catch(() => false)) return;
    if (Date.now() >= deadline) {
      // A genuine failure here is exactly the kind of thing worth a real repro dump, not just a
      // bare "not found" — this only ever runs on the way to an already-failing assertion.
      // eslint-disable-next-line no-console
      console.log(
        'waitForCharacterInList: timed out; current list rows =',
        JSON.stringify(await page.locator('.characters-list__item').allTextContents()),
      );
      // Final attempt through a real (auto-retrying) assertion, so a genuine failure reports
      // Playwright's own useful locator/timeout diagnostics rather than a bare boolean.
      await expect(row).toBeVisible({ timeout: 1_000 });
      return;
    }
    await page.waitForTimeout(500);
  }
}

/** Opens a `/characters` list row by its exact character name and waits for the sheet's play tab
 * to render — same "open by name" shape `characters-list.component.html`'s row markup supports
 * (no other per-row id is rendered in the DOM to key off instead). Polls for the row first (see
 * `waitForCharacterInList`'s doc) rather than assuming one `goto` is enough. */
export async function openCharacterByName(page: Page, name: string): Promise<void> {
  await waitForCharacterInList(page, name);
  const row = page.locator('.characters-list__item', { hasText: name });
  await row.locator('.characters-list__open').click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/play$/);
  await expect(page.locator('.play-tab')).toBeVisible();
}

/** The sync badge (`characters-list.component.html`) for the row named `name` — asserted against
 * its `data-sync-state` attribute (`'offline' | 'connecting' | 'synced' | 'pending'`). */
export function syncBadgeForName(page: Page, name: string) {
  return page
    .locator('.characters-list__item', { hasText: name })
    .locator('.characters-list__sync-badge');
}

/** `.play-tab__hp-stats hk-stat-tile` value locator, by the tile's own `hasText` label — same
 * shape `../play-actions.spec.ts`'s own (unexported) `hpValueLocator` uses for the exact same
 * section. */
export function hpValueLocator(page: Page, label: 'Current' | 'Max') {
  return page
    .locator('.play-tab__hp-stats')
    .locator('hk-stat-tile', { hasText: label })
    .locator('.hk-stat-tile__value');
}

/** `.play-tab__stats hk-stat-tile` value locator for Armor Class — same shape
 * `../create-fighter.spec.ts`'s own AC assertion uses. */
export function acValueLocator(page: Page) {
  return page
    .locator('.play-tab__stats')
    .locator('hk-stat-tile', { hasText: 'Armor Class' })
    .locator('.hk-stat-tile__value');
}

/** Fills the shared HP-controls amount field and clicks the named action button — same shape
 * `../play-actions.spec.ts`'s own (unexported) `applyHp` uses. */
export async function applyHp(
  page: Page,
  amount: number,
  action: 'Damage' | 'Heal',
): Promise<void> {
  await page.locator('.play-tab__hp-controls input').fill(String(amount));
  await page.getByRole('button', { name: action, exact: true }).click();
}
