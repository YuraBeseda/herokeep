import { AuthClientError, authErrorKey, AuthService } from './auth.service';
import { ApiError } from '../api/api-fetch';

/** No Angular DI dependencies live in `AuthService` (see its header comment) — every test below
 * constructs it with plain `new AuthService()`, no `TestBed` needed. `globalThis.fetch` is
 * stubbed per test (same style as `api-fetch.spec.ts`/`password-check.spec.ts`) since
 * `AuthService` routes every request through the REAL `apiJson`/`apiFetch` (Task 1) and the REAL
 * `deriveVerifierHex`/`randomSaltHex` (Task 2) — only the network boundary is faked, so a passing
 * "login happy path" test proves the real salt→derive→POST wiring, not a mocked stand-in for it.
 */

// Cross-pinned PBKDF2 vector — DUPLICATED from auth-crypto.spec.ts on purpose (same repo
// convention as that file's own header comment: "computed once ... pinned in BOTH suites via a
// comment cross-reference"). Proves `login()` sends the EXACT derived verifier hex, not just
// "some" hex string.
const VECTOR_PASSWORD = 'correct horse battery staple';
const VECTOR_SALT_HEX = '000102030405060708090a0b0c0d0e0f';
const VECTOR_VERIFIER_HEX = 'ef177144eec9420cbc1093d2a8b344a92bc506d0d4ec9c028dd19f8324d8c1e6';

// checkPassword's common-list check is exercised through this fixture whenever AuthService needs
// a password that PASSES all local checks (register/reset happy paths) — kept deliberately far
// from every password literal used below so none of them accidentally collide with it.
const COMMON_LIST_FIXTURE = 'password\nletmein\nqwerty123\n';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Waits a macrotask so `AuthService.init()`'s intentionally-unawaited internal promise (and any
 * other fire-and-forget async chain under test) has had a chance to settle. `init()`'s contract
 * is `void`, not `Promise<void>` (see its doc comment) — there is nothing to `await` directly. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** A tiny URL-keyed fetch router: each test declares only the endpoints it needs, and calling an
 * undeclared URL throws loudly (rather than silently returning `undefined`) so a wiring bug in
 * `AuthService` (wrong path, wrong method) fails the test instead of hanging. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function routedFetch(routes: Record<string, Handler>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const key = Object.keys(routes).find((k) =>
      k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k,
    );
    if (!key) throw new Error(`routedFetch: no handler declared for ${url}`);
    return routes[key](init);
  });
}

describe('AuthService', () => {
  const originalFetch = globalThis.fetch;
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('init', () => {
    it('never throws synchronously, even when the network is unreachable', () => {
      globalThis.fetch = routedFetch({
        '/api/me': () => {
          throw new TypeError('Failed to fetch');
        },
      });
      expect(() => authService.init()).not.toThrow();
    });

    it('a network-level failure (offline) resolves to anon, not a throw, and notes offlineAtInit', async () => {
      globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

      authService.init();
      await flush();

      expect(authService.status()).toBe('anon');
      expect(authService.user()).toBeNull();
      expect(authService.offlineAtInit()).toBe(true);
    });

    it('a 200 GET /api/me resolves to authed with the returned user', async () => {
      globalThis.fetch = routedFetch({
        '/api/me': () => jsonResponse(200, { userId: 'u1', username: 'alice' }),
      });

      authService.init();
      await flush();

      expect(authService.status()).toBe('authed');
      expect(authService.user()).toEqual({ userId: 'u1', username: 'alice' });
      expect(authService.offlineAtInit()).toBe(false);
    });

    it('a 401 GET /api/me (no session) resolves to anon without setting offlineAtInit', async () => {
      globalThis.fetch = routedFetch({
        '/api/me': () => jsonResponse(401, { error: 'unauthorized', message: 'Unauthorized' }),
      });

      authService.init();
      await flush();

      expect(authService.status()).toBe('anon');
      expect(authService.user()).toBeNull();
      expect(authService.offlineAtInit()).toBe(false);
    });
  });

  describe('login', () => {
    it('rejects a malformed username locally, with NO network call at all', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;

      await expect(
        authService.login('a!', 'whatever-password', 'Test device'),
      ).rejects.toMatchObject({
        name: 'AuthClientError',
        reason: 'invalid-username',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('happy path: fetches the salt, derives the EXACT pinned verifier, then POSTs login with it', async () => {
      let loginBody: unknown;
      globalThis.fetch = routedFetch({
        '/api/auth/salt*': () => jsonResponse(200, { salt: VECTOR_SALT_HEX }),
        '/api/auth/login': (init) => {
          loginBody = JSON.parse(init?.body as string);
          return jsonResponse(200, { userId: 'u1' });
        },
      });

      await authService.login('alice', VECTOR_PASSWORD, 'Chrome on Windows');

      expect(loginBody).toEqual({
        username: 'alice',
        verifier: VECTOR_VERIFIER_HEX,
        deviceLabel: 'Chrome on Windows',
      });
      expect(authService.status()).toBe('authed');
      expect(authService.user()).toEqual({ userId: 'u1', username: 'alice' });
    });

    it('a server-side rejection (401 invalid credentials) rethrows as ApiError and leaves state unauthed', async () => {
      globalThis.fetch = routedFetch({
        '/api/auth/salt*': () => jsonResponse(200, { salt: VECTOR_SALT_HEX }),
        '/api/auth/login': () =>
          jsonResponse(401, { error: 'unauthorized', message: 'Invalid username or password' }),
      });

      await expect(authService.login('alice', 'wrong-password-1', 'Device')).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(authService.status()).not.toBe('authed');
      expect(authService.user()).toBeNull();
    });
  });

  describe('register', () => {
    it('rejects a weak (too-short) password locally, with NO network call at all', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;

      await expect(authService.register('alice', 'short1', 'Device')).rejects.toMatchObject({
        name: 'AuthClientError',
        reason: 'too-short',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('happy path: registers, returns the recovery codes, AND auto-logs-in', async () => {
      const calledUrls: string[] = [];
      globalThis.fetch = routedFetch({
        '/assets/auth/top-10k-passwords.txt': () =>
          new Response(COMMON_LIST_FIXTURE, { status: 200 }),
        '/api/auth/register': (init) => {
          calledUrls.push('register');
          expect(JSON.parse(init?.body as string)).toMatchObject({ username: 'bob' });
          return jsonResponse(201, {
            userId: 'u2',
            recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
          });
        },
        '/api/auth/salt*': () => {
          calledUrls.push('salt');
          return jsonResponse(200, { salt: VECTOR_SALT_HEX });
        },
        '/api/auth/login': () => {
          calledUrls.push('login');
          return jsonResponse(200, { userId: 'u2' });
        },
      });

      const result = await authService.register('bob', 'a-strong-unique-passphrase', 'Device');

      expect(result).toEqual({ recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] });
      // register's POST must precede the auto-login's salt/login calls.
      expect(calledUrls).toEqual(['register', 'salt', 'login']);
      expect(authService.status()).toBe('authed');
      expect(authService.user()).toEqual({ userId: 'u2', username: 'bob' });
    });
  });

  describe('reset', () => {
    it('rejects a weak password locally before any network call', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;

      await expect(authService.reset('alice', 'ABCDE-FGHIJ', 'short1')).rejects.toMatchObject({
        name: 'AuthClientError',
        reason: 'too-short',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('happy path: resets credentials then auto-logs-in with the new password', async () => {
      const calledUrls: string[] = [];
      globalThis.fetch = routedFetch({
        '/assets/auth/top-10k-passwords.txt': () =>
          new Response(COMMON_LIST_FIXTURE, { status: 200 }),
        '/api/auth/reset': () => {
          calledUrls.push('reset');
          return jsonResponse(200, { userId: 'u3' });
        },
        '/api/auth/salt*': () => {
          calledUrls.push('salt');
          return jsonResponse(200, { salt: VECTOR_SALT_HEX });
        },
        '/api/auth/login': () => {
          calledUrls.push('login');
          return jsonResponse(200, { userId: 'u3' });
        },
      });

      await authService.reset('carol', 'ABCDE-FGHIJ', 'another-strong-passphrase');

      expect(calledUrls).toEqual(['reset', 'salt', 'login']);
      expect(authService.status()).toBe('authed');
      expect(authService.user()).toEqual({ userId: 'u3', username: 'carol' });
    });
  });

  describe('logout / logoutAll', () => {
    async function loginFirst(): Promise<void> {
      globalThis.fetch = routedFetch({
        '/api/auth/salt*': () => jsonResponse(200, { salt: VECTOR_SALT_HEX }),
        '/api/auth/login': () => jsonResponse(200, { userId: 'u1' }),
      });
      await authService.login('alice', VECTOR_PASSWORD, 'Device');
      expect(authService.status()).toBe('authed');
    }

    it('logout() clears local state even when the network request fails', async () => {
      await loginFirst();
      globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(authService.logout()).resolves.toBeUndefined();

      expect(authService.status()).toBe('anon');
      expect(authService.user()).toBeNull();
    });

    it('logout() clears local state on a successful 204', async () => {
      await loginFirst();
      globalThis.fetch = routedFetch({ '/api/auth/logout': () => noBodyResponse(204) });

      await authService.logout();

      expect(authService.status()).toBe('anon');
      expect(authService.user()).toBeNull();
    });

    it('logoutAll() clears local state even when the network request fails', async () => {
      await loginFirst();
      globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(authService.logoutAll()).resolves.toBeUndefined();

      expect(authService.status()).toBe('anon');
      expect(authService.user()).toBeNull();
    });
  });
});

describe('authErrorKey', () => {
  it('maps each AuthClientError reason to its scope-relative validation key', () => {
    expect(authErrorKey(new AuthClientError('invalid-username'))).toBe(
      'validation.invalidUsername',
    );
    expect(authErrorKey(new AuthClientError('too-short'))).toBe('validation.tooShort');
    expect(authErrorKey(new AuthClientError('too-long'))).toBe('validation.tooLong');
    expect(authErrorKey(new AuthClientError('common'))).toBe('validation.common');
    expect(authErrorKey(new AuthClientError('contains-username'))).toBe(
      'validation.containsUsername',
    );
  });

  it('maps known ApiError codes to their scope-relative error keys', () => {
    expect(authErrorKey(new ApiError(401, 'unauthorized', 'x'))).toBe('errors.invalidCredentials');
    expect(authErrorKey(new ApiError(429, 'too_many_requests', 'x'))).toBe('errors.lockout');
    expect(authErrorKey(new ApiError(409, 'conflict', 'x'))).toBe('errors.usernameTaken');
    expect(authErrorKey(new ApiError(400, 'bad_request', 'x'))).toBe('errors.badRequest');
    expect(authErrorKey(new ApiError(0, 'network_error', 'x'))).toBe('errors.network');
  });

  it('falls back to a generic key for an unmapped ApiError code or a non-auth error', () => {
    expect(authErrorKey(new ApiError(500, 'internal_error', 'x'))).toBe('errors.generic');
    expect(authErrorKey(new Error('boom'))).toBe('errors.generic');
    expect(authErrorKey('not even an error')).toBe('errors.generic');
  });
});
