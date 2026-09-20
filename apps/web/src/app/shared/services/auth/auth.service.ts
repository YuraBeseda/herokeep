/** Client auth/session state (Task 4 brief, plan-8's design ruling 3): a root-provided service
 * holding `who am I / am I authed` as signals, plus the register/login/reset/logout flows built
 * on Task 1's `apiJson`/`ApiError`, Task 2's `deriveVerifierHex`/`randomSaltHex`, and Task 3's
 * `checkPassword`. `SyncService` (T6/T8) reads `status()` to decide when to run sync sessions —
 * this file only owns "am I logged in", never socket/sync state.
 *
 * No Angular DI dependencies (`inject()`) are needed here — every collaborator is a plain
 * exported function (`apiJson`, `deriveVerifierHex`, `randomSaltHex`, `checkPassword`), not an
 * injectable service — so this class is `new`-able directly in specs without `TestBed`.
 */
import { Injectable, signal, type Signal } from '@angular/core';
import { apiJson, ApiError } from '../api/api-fetch';
import { deriveVerifierHex, randomSaltHex } from './auth-crypto';
import { checkPassword, type PasswordVerdict } from './password-check';

export interface AuthUser {
  readonly userId: string;
  readonly username: string;
}

export type AuthStatus = 'unknown' | 'authed' | 'anon';

/** Every reason `AuthService` rejects a call BEFORE it ever touches the network: a malformed
 * username (mirrors the server's format rule — see `USERNAME_PATTERN` below) or a weak password
 * (mirrors `password-check.ts`'s `PasswordVerdict.reason`). Thrown as `AuthClientError`, never as
 * an `ApiError` (which is reserved for "the server said no" / "the network failed") — callers
 * (T5's forms) can tell "fix your input" apart from "something server/network-side went wrong"
 * by the error's constructor without inspecting strings. */
export type AuthClientErrorReason =
  'invalid-username' | Exclude<PasswordVerdict, { ok: true }>['reason'];

export class AuthClientError extends Error {
  readonly reason: AuthClientErrorReason;

  constructor(reason: AuthClientErrorReason) {
    super(`auth: local validation failed (${reason})`);
    this.name = 'AuthClientError';
    this.reason = reason;
  }
}

// Mirrors apps/api/src/core/auth/username.ts's `USERNAME_PATTERN` EXACTLY (3–32 Unicode
// letters/digits/`_`/`-`, `u` flag so astral characters count as one code point) — this is a
// client-side FAST-FAIL convenience only; the server re-validates and is the source of truth
// (this file has no access to `apps/api` code, so the pattern is copied, not imported).
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u;

/** Exported for T5's register/recover screens: live, local "is this shaped like a username"
 * feedback as the user types, using the EXACT same pattern `assertValidUsername` throws on below
 * — one source of truth for the client-side format check. */
export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

function assertValidUsername(username: string): void {
  if (!isValidUsername(username)) {
    throw new AuthClientError('invalid-username');
  }
}

async function assertStrongPassword(password: string, username: string): Promise<void> {
  const verdict = await checkPassword(password, username);
  if (!verdict.ok) {
    throw new AuthClientError(verdict.reason);
  }
}

interface MeResponse {
  readonly userId: string;
  readonly username: string;
}

interface SaltResponse {
  readonly salt: string;
}

interface LoginResponse {
  readonly userId: string;
}

interface RegisterResponse {
  readonly userId: string;
  readonly recoveryCodes: string[];
}

interface ResetResponse {
  readonly userId: string;
}

/** `apps/api/src/core/auth/login.ts`'s `normalizeDeviceLabel` default, mirrored here so an
 * internal auto-login (register/reset — neither takes a `deviceLabel` param per the brief's
 * `Produces` signature) sends something meaningful instead of `undefined`; the server would
 * apply the exact same default anyway, this just keeps `login()`'s own default logic in ONE
 * place (this constant) rather than depending on the server's fallback silently matching. */
const DEFAULT_DEVICE_LABEL = 'Unknown device';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userState = signal<AuthUser | null>(null);
  private readonly statusState = signal<AuthStatus>('unknown');
  // Ruling 3 ("offline → logged-out UI state with a 'last known' hint"): `init()` never blocks
  // and never throws, but a network-level failure (as opposed to a real 401) is worth
  // remembering — a future settings/shell affordance can read this to show "couldn't reach the
  // server" instead of a flat "logged out", without changing `status`'s three-value contract.
  private readonly offlineAtInitState = signal(false);

  readonly user: Signal<AuthUser | null> = this.userState.asReadonly();
  readonly status: Signal<AuthStatus> = this.statusState.asReadonly();
  readonly offlineAtInit: Signal<boolean> = this.offlineAtInitState.asReadonly();

  /** `GET /api/me` once, fire-and-forget (ruling 3: "ONCE at app init, non-blocking,
   * network-failure-tolerant"). Deliberately returns `void`, not `Promise<void>` — a caller
   * wiring this into `provideAppInitializer` must NOT be able to accidentally `await` it and
   * block bootstrap; the async work happens in `performInit` below, whose promise this method
   * intentionally discards (with `void`, not left dangling-unhandled: `performInit` catches
   * everything internally, so there is nothing left for an unhandled-rejection listener to see).
   */
  init(): void {
    void this.performInit();
  }

  private async performInit(): Promise<void> {
    try {
      const me = await apiJson<MeResponse>('/api/me');
      this.userState.set({ userId: me.userId, username: me.username });
      this.statusState.set('authed');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        this.offlineAtInitState.set(true);
      }
      this.userState.set(null);
      this.statusState.set('anon');
    }
  }

  /** Username/password → session. Salt→derive→login (ADR-012): fetches the user's real salt (or
   * the server's indistinguishable fake one for an unknown username — no existence oracle), then
   * derives the PBKDF2 verifier client-side and posts it. Server errors (401 invalid
   * credentials, 429 lockout, ...) propagate as `ApiError` for the caller (T5's login form) to
   * map to a message; a local username-format failure throws `AuthClientError` first, before any
   * network call. `deviceLabel` is optional so `register`/`reset`'s internal auto-login below can
   * omit it (the brief's `Produces` signature for those two has no `deviceLabel` parameter). */
  async login(username: string, password: string, deviceLabel?: string): Promise<void> {
    assertValidUsername(username);

    const { salt } = await apiJson<SaltResponse>(
      `/api/auth/salt?username=${encodeURIComponent(username)}`,
    );
    const verifier = await deriveVerifierHex(password, salt);
    const result = await apiJson<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        verifier,
        deviceLabel: deviceLabel ?? DEFAULT_DEVICE_LABEL,
      }),
    });

    // The login response only echoes `userId` (apps/api/src/core/routes/auth.ts) — `username`
    // in `AuthUser` comes from this call's own input, not a server echo. Set optimistically here
    // so a caller-typed casing is at least SOMETHING to show immediately, then canonicalized
    // below.
    this.userState.set({ userId: result.userId, username });
    this.statusState.set('authed');

    // Task-4-review carried obligation: the server folds username case (`foldUsername`) for
    // lookups but stores/returns the ORIGINAL casing a user first registered with — the casing
    // this caller just typed at the login prompt may drift from that (e.g. "Alice" vs "alice").
    // One extra `GET /api/me` canonicalizes it. Best-effort: a network failure here must not
    // undo the successful login above, so it's swallowed and the caller-typed username (already
    // set) stands.
    try {
      const me = await apiJson<MeResponse>('/api/me');
      this.userState.set({ userId: me.userId, username: me.username });
    } catch {
      // See comment above — tolerated silently, caller-typed casing remains authoritative.
    }
  }

  /** Register a new account. `checkPassword` runs FIRST (task-4-brief.md), rejecting a weak
   * password with NO network call at all — not even the salt/register request — before the
   * (also-local) username-format check. `POST /api/auth/register` does NOT create a session
   * (apps/api/src/core/routes/auth.ts's `/register` handler never calls `setSessionCookie`,
   * unlike `/login`) so, once the account exists, this calls `login()` internally with the same
   * in-memory credentials to establish a session — the caller only ever sees ONE outstanding
   * promise and ends up authed, matching what a user expects from "register". The raw password
   * is only ever held in this function's own stack, for the duration of these two calls. */
  async register(
    username: string,
    password: string,
    deviceLabel?: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await assertStrongPassword(password, username);
    assertValidUsername(username);

    const salt = randomSaltHex();
    const verifier = await deriveVerifierHex(password, salt);
    const result = await apiJson<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, verifier, salt }),
    });

    await this.login(username, password, deviceLabel);

    return { recoveryCodes: result.recoveryCodes };
  }

  /** Recovery-code reset: burns `code`, sets a new salt+verifier for `newPassword`. Like
   * `register`, `POST /api/auth/reset` (apps/api/src/core/auth/recovery.ts) does not create a
   * session — it also `deleteSessionsForUser`s as part of the reset — so this auto-logs-in
   * afterward with the new password, same reasoning as `register` above. */
  async reset(username: string, code: string, newPassword: string): Promise<void> {
    await assertStrongPassword(newPassword, username);
    assertValidUsername(username);

    const newSalt = randomSaltHex();
    const newVerifier = await deriveVerifierHex(newPassword, newSalt);
    await apiJson<ResetResponse>('/api/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ username, recoveryCode: code, newSalt, newVerifier }),
    });

    await this.login(username, newPassword);
  }

  /** Ends the current device's session. Tolerates a network failure (or any other server error)
   * by clearing local state anyway — from the user's perspective "log out" must always succeed
   * locally, even offline; a still-valid session cookie left behind on an unreachable server is
   * strictly less harmful than a logout button that appears to do nothing. The server-side
   * session (if reachable) is still asked to end first, so the common case is a real logout, not
   * just a local one. */
  async logout(): Promise<void> {
    try {
      await apiJson<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // See method doc: any failure here (network-down, already-expired session, ...) is
      // swallowed — local state clears unconditionally below.
    } finally {
      this.userState.set(null);
      this.statusState.set('anon');
    }
  }

  /** Same tolerance contract as `logout()`, but ends every session for this user
   * (`POST /api/auth/logout-all`), e.g. after a suspected compromised device. */
  async logoutAll(): Promise<void> {
    try {
      await apiJson<void>('/api/auth/logout-all', { method: 'POST' });
    } catch {
      // See logout()'s doc comment — identical tolerance contract.
    } finally {
      this.userState.set(null);
      this.statusState.set('anon');
    }
  }
}

const API_ERROR_KEYS: Readonly<Partial<Record<string, string>>> = {
  unauthorized: 'errors.invalidCredentials',
  too_many_requests: 'errors.lockout',
  conflict: 'errors.usernameTaken',
  bad_request: 'errors.badRequest',
  network_error: 'errors.network',
};

const CLIENT_ERROR_KEYS: Readonly<Record<AuthClientErrorReason, string>> = {
  'invalid-username': 'validation.invalidUsername',
  'too-short': 'validation.tooShort',
  'too-long': 'validation.tooLong',
  common: 'validation.common',
  'contains-username': 'validation.containsUsername',
};

/** Same scope-relative key table `authErrorKey` uses for a THROWN `AuthClientError`, exposed
 * directly for T5's register/recover screens' LIVE `checkPassword` verdicts — those never throw
 * (`PasswordVerdict` is a plain return value, checked before `AuthService.register`/`reset` ever
 * runs), so there is no `AuthClientError` to hand `authErrorKey`, just the verdict's own `reason`.
 * One shared table either way keeps the validation copy identical between "you typed something
 * invalid" (live, pre-submit) and "the server/local check rejected it" (post-submit) paths. */
export function passwordVerdictKey(
  reason: Exclude<PasswordVerdict, { ok: true }>['reason'],
): string {
  return CLIENT_ERROR_KEYS[reason];
}

/** Maps an error thrown by any `AuthService` method onto a key RELATIVE to the `auth` Transloco
 * scope (no `auth.` prefix — pass the result straight into the translate function bound under
 * `*transloco="let t; read: 'auth'"`) — consumed by T5's login/register/recover screens so
 * error-message wiring lives in one place instead of being re-derived per form.
 * `AuthClientError` maps through its own `reason`; `ApiError` maps through `code` (the wire
 * shape's machine string, `apps/api/src/core/errors.ts`); anything else (a bug, not a modeled
 * failure) falls back to a generic message. */
export function authErrorKey(err: unknown): string {
  if (err instanceof AuthClientError) {
    return CLIENT_ERROR_KEYS[err.reason];
  }
  if (err instanceof ApiError) {
    return API_ERROR_KEYS[err.code ?? ''] ?? 'errors.generic';
  }
  return 'errors.generic';
}
