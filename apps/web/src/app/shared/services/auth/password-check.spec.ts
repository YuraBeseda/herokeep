import type { checkPassword as CheckPasswordFn } from './password-check';

/** `checkPassword`'s common-list fetch is memoized at MODULE scope (one promise for the
 * whole module instance, per `password-check.ts`'s header comment). To keep every test
 * below independent (so an earlier test's cached list/failure never leaks into a later
 * one), each test `vi.resetModules()`s and re-`import()`s the module fresh in `beforeEach`
 * — this is also what makes the "memoization" describe block below meaningful: it proves
 * TWO calls within the SAME module instance share one fetch, which would be masked if the
 * module were reset between them too.
 *
 * Unit specs use a SMALL inline fixture list behind a stubbed `fetch`, never the real
 * ~10k-line bundled asset (slow, and couples these specs to the list's exact contents). The
 * real asset's existence/shape (newline-separated, lowercase, deduplicated, parses) is
 * instead verified by a separate Node-environment spec,
 * `apps/web/tools/password-list-asset.spec.ts` (jsdom specs can't reach the filesystem
 * cleanly) — see that file's header comment for why it's a separate file. An e2e-level
 * assertion that the register screen can actually fetch the asset from the served app is
 * deferred to T11.
 */

const COMMON_FIXTURE = ['password', 'letmein123', 'aliceiscool123'].join('\n');

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('checkPassword', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let checkPassword: typeof CheckPasswordFn;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    ({ checkPassword } = await import('./password-check'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('length rules (checked first)', () => {
    it('rejects a password shorter than 10 characters as too-short', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('short1234', 'someone')).resolves.toEqual({
        ok: false,
        reason: 'too-short',
      });
    });

    it('accepts exactly 10 characters at the boundary (not short, not common, no username)', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('abcdefghij', 'someone')).resolves.toEqual({ ok: true });
    });

    it('rejects a password longer than 128 characters as too-long', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('a'.repeat(129), 'someone')).resolves.toEqual({
        ok: false,
        reason: 'too-long',
      });
    });

    it('accepts exactly 128 characters at the boundary', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('a'.repeat(128), 'someone')).resolves.toEqual({ ok: true });
    });

    it('length is checked before username-containment: a too-short password that also contains the username reports too-short', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('alice1', 'alice')).resolves.toEqual({
        ok: false,
        reason: 'too-short',
      });
    });
  });

  describe('username containment (checked second)', () => {
    it('rejects a password that contains the username, both case-folded to lowercase', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('MySecretAlicePass1', 'alice')).resolves.toEqual({
        ok: false,
        reason: 'contains-username',
      });
    });

    it('folds the other direction too: an uppercase username still matches a lowercase password', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('mysecretalicepass1', 'Alice')).resolves.toEqual({
        ok: false,
        reason: 'contains-username',
      });
    });

    it('skips the containment check for a username shorter than 3 characters', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('myabpassword1', 'ab')).resolves.toEqual({ ok: true });
    });

    it('skips the containment check for an empty username', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('someplainpassword1', '')).resolves.toEqual({ ok: true });
    });

    it('username-containment is checked before the common-list check: a password that is BOTH common AND contains the username reports contains-username', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      // 'aliceiscool123' is verbatim on COMMON_FIXTURE (would report 'common' on its own)
      // and also contains the username 'alice' — the ordering rule means contains-username wins.
      await expect(checkPassword('aliceiscool123', 'alice')).resolves.toEqual({
        ok: false,
        reason: 'contains-username',
      });
    });
  });

  describe('common-password list (checked last)', () => {
    it('rejects a password that is on the (fixture) common list, case-folded', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      // 'LETMEIN123' (10 chars, clears the length floor) folds to 'letmein123', which is
      // verbatim on COMMON_FIXTURE.
      await expect(checkPassword('LETMEIN123', 'someone')).resolves.toEqual({
        ok: false,
        reason: 'common',
      });
    });

    it('accepts a password absent from the fixture list', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await expect(checkPassword('correcthorsebattery', 'someone')).resolves.toEqual({ ok: true });
    });

    it('fetches the list from /assets/auth/top-10k-passwords.txt', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await checkPassword('correcthorsebattery', 'someone');
      expect(fetchMock).toHaveBeenCalledWith('/assets/auth/top-10k-passwords.txt');
    });
  });

  describe('degrade-open on list-fetch failure', () => {
    it('a rejected fetch (offline) is swallowed: the common check is skipped and an otherwise-fine password is ok', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(checkPassword('correcthorsebattery', 'someone')).resolves.toEqual({ ok: true });
    });

    it('a non-2xx response (e.g. the asset 404s) is swallowed the same way', async () => {
      fetchMock.mockResolvedValue(textResponse(404, 'not found'));
      await expect(checkPassword('correcthorsebattery', 'someone')).resolves.toEqual({ ok: true });
    });

    it('never logs to the console on a fetch failure (silent degrade-open)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(checkPassword('correcthorsebattery', 'someone')).resolves.toEqual({ ok: true });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('length and username-containment checks still run normally even though the list fetch will fail', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(checkPassword('short', 'someone')).resolves.toEqual({
        ok: false,
        reason: 'too-short',
      });
    });
  });

  describe('memoization', () => {
    it('fetches the list only once across two checkPassword calls', async () => {
      fetchMock.mockResolvedValue(textResponse(200, COMMON_FIXTURE));
      await checkPassword('correcthorsebattery', 'someone');
      await checkPassword('anotherfineone1', 'someone');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still memoizes (does not retry) after a fetch failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await checkPassword('correcthorsebattery', 'someone');
      await checkPassword('anotherfineone1', 'someone');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
