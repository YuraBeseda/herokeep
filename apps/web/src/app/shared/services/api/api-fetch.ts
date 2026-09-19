/** Thin fetch wrapper for `apps/api` (doc-10/ADR-012 wire truth), consumed by `AuthService`/
 * `SyncService` (T4/T8/T9). Relative URLs only — this app never calls a cross-origin API.
 *
 * CSRF gate: `apps/api/src/core/http/xrw-gate.ts` 403s any non-GET request whose
 * `X-Requested-With` header is not the EXACT string `'herokeep'` (not the common
 * `'XMLHttpRequest'` convention — verified against the shipped gate, which also has a test
 * asserting `'XMLHttpRequest'` is REJECTED). GET is exempt (and must stay so: attaching the
 * header would make plain cross-site navigations to a GET-mutating endpoint distinguishable,
 * which is not this API's threat model, but simpler to just match the server exactly).
 *
 * Error wire shape: `apps/api/src/core/http/error-handler.ts` serializes
 * `{ error: <code string>, message: <string> }` — `error` IS the machine code, not a nested
 * object. `ApiError.code` reads `body.error`.
 */

const XRW_HEADER = 'X-Requested-With';
const XRW_VALUE = 'herokeep';

/** Thrown by `apiFetch`/`apiJson`. A `status: 0` instance is a NETWORK-level failure (the
 * `fetch()` call itself rejected — offline, DNS, CORS, aborted, ...) — the server was never
 * reached, so there is no `code`/response body to report. Callers distinguish "offline" from
 * "server said no" with `err.status === 0`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** `fetch()` wrapper: same-origin relative `path`, `credentials: 'same-origin'` by default
 * (override via `init.credentials`), and the CSRF header on every non-GET method. A rejected
 * `fetch()` (network failure) is rethrown as an `ApiError` with `status: 0`, `code:
 * 'network_error'` rather than propagating the raw `TypeError` — one error type for callers to
 * catch. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET') {
    headers.set(XRW_HEADER, XRW_VALUE);
  }

  try {
    return await fetch(path, {
      ...init,
      method,
      credentials: init.credentials ?? 'same-origin',
      headers,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Network request failed';
    throw new ApiError(0, 'network_error', message);
  }
}

/** JSON convenience over `apiFetch`: resolves with the parsed body on a 2xx response, otherwise
 * throws an `ApiError` built from the server's `{error, message}` body (falling back to
 * `response.statusText` when the body isn't JSON — a proxy/edge failure never reaches the app's
 * own error handler). A network-level failure from `apiFetch` propagates unchanged. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await apiFetch(path, { ...init, headers });

  if (!response.ok) {
    let code: string | undefined;
    let message = response.statusText || 'Request failed';
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (typeof body.error === 'string') {
        code = body.error;
      }
      if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // Non-JSON error body (e.g. an intermediary proxy's HTML page) — keep the defaults above.
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
