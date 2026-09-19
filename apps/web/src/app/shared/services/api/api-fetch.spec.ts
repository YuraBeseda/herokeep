import { apiFetch, apiJson, ApiError } from './api-fetch';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does NOT set X-Requested-With on a GET request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/me');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Requested-With')).toBe(false);
  });

  it('sets X-Requested-With: herokeep on a POST request (server-required exact value)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/characters', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Requested-With')).toBe('herokeep');
  });

  it('sets X-Requested-With on DELETE and PATCH too, not only POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/characters/abc', { method: 'DELETE' });
    await apiFetch('/api/characters/abc', { method: 'PATCH' });

    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('X-Requested-With')).toBe('herokeep');
    }
  });

  it('defaults credentials to same-origin', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/me');

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe('same-origin');
  });

  it('lets a caller override credentials explicitly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch('/api/me', { credentials: 'omit' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe('omit');
  });

  it('rethrows a network-level fetch rejection as an ApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiFetch('/api/me')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('the network-failure rejection is an ApiError instance distinguishable from a server response', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await apiFetch('/api/me');
      throw new Error('expected apiFetch to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    }
  });
});

describe('apiJson', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves with the parsed JSON body on a 2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { userId: 'u1' }));

    await expect(apiJson('/api/me')).resolves.toEqual({ userId: 'u1' });
  });

  it('maps the server error-handler wire shape {error, message} onto ApiError.code/message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: 'forbidden', message: 'Missing X-Requested-With header' }),
    );

    await expect(apiJson('/api/characters')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Missing X-Requested-With header',
    });
  });

  it('maps a 409 quota_exceeded body exactly (distinct code from conflict)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'quota_exceeded', message: 'Quota exceeded' }),
    );

    await expect(apiJson('/api/characters', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409,
      code: 'quota_exceeded',
    });
  });

  it('propagates the network-failure ApiError (status 0) unchanged through apiJson', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiJson('/api/me')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});
