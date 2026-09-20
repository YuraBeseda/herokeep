/**
 * Task 9 (phase-2 plan, doc-10 §Portability tests): ONE scenario table exercised by BOTH adapters
 * — `node.conformance.test.ts` (a real Node adapter boot, real `fetch`/`ws`) and
 * `cloudflare.conformance.test.ts` (the real Worker under `@cloudflare/vitest-pool-workers`, real
 * `SELF.fetch` + the DO-level `StreamDriver` fallback task-8-brief pre-authorized for WS — see that
 * file's own header comment for why). Every scenario here is written against the black-box
 * `ConformanceDriver`/`StreamDriver` interfaces below — `fetch`/WebSocket-shaped operations only,
 * never a store/port internal — so a scenario that passes against one adapter and fails against the
 * other is a REAL cross-adapter divergence, not a harness artifact (Global Constraints: "A scenario
 * passing on one adapter and failing on the other is a merge blocker").
 *
 * Every assertion for every scenario lives HERE. Both runner files contain zero assertions of their
 * own — only `ConformanceDriver`/`StreamDriver` wiring — by design: that split is what makes a
 * cross-adapter failure trustworthy (task-9-brief).
 *
 * [plan-9 Task 10] Campaign scenarios extend the SAME architecture, with one addition:
 * `Scenario.adapters` (optional — every pre-existing scenario omits it and runs on both, unchanged)
 * lets a scenario declare it only runs on a SUBSET of adapters. This is NOT an escape hatch for a
 * real cross-adapter divergence (Global Constraints: "a scenario passing on one adapter and failing
 * on the other is a merge blocker" — that rule is about a genuine behavior difference between the
 * two PRODUCTION adapters, discovered by running the SAME scenario against both). It exists for
 * exactly one documented, structural HARNESS limitation, carried from task-8-brief/task-9-report:
 * the Cloudflare runner's `openStream` never performs a REAL WebSocket upgrade (pool-workers cannot
 * complete one against a Durable Object under its default per-test storage isolation — see
 * `cloudflare.conformance.test.ts`'s own header comment) — it calls `webSocketMessage()` directly
 * against a mocked pair. That mocked pair is NEVER run through `HibernatingConnections.accept()`
 * (`adapters/cloudflare/connections.do.ts`), which is the ONLY place a connection is registered with
 * the platform's `ctx.acceptWebSocket()`/tag mechanism `Connections.all()`/`byTag()` depend on. A
 * scenario needing the actor to push a frame to a DIFFERENT connection than the one that triggered
 * it (a live `members` presence broadcast, a `bye` close) is therefore unobservable through THIS
 * driver on Cloudflare — not because campaign presence/bye is broken there (Task 9's own CF DO test
 * proves the RPC methods are wired and reachable; Task 9's own ledger already names "CF
 * getWebSockets(tag) multi-socket fan-out" as an accepted gap), but because the test harness itself
 * cannot express it without simulating platform Hibernation internals, which the brief explicitly
 * says not to force. Every scenario whose assertions depend ONLY on the initiating connection's own
 * synchronous replies (ack/reject/welcome/catch-up `events`) — which covers append/permission/
 * visibility-filtering/gateway/mirror scenarios, since `filterForConnection` gates catch-up the same
 * way it gates live fan-out — runs on BOTH adapters like every other scenario in this file.
 */
import { expect } from 'vitest';
import type {
  AckMsg,
  ByeMsg,
  ClientMessage,
  Event,
  EventsMsg,
  MembersMsg,
  RejectCode,
  RejectMsg,
  ServerMessage,
  WelcomeMsg,
} from '@hk/protocol';

// --- driver surface (implemented once per runner; scenarios never see an adapter-specific type) --

/** An already-authenticated identity a scenario can act as. `userId` is needed by the Cloudflare
 * runner's `openStream` (it cannot complete a real WS upgrade through the Worker's own session/
 * ownership routing under pool-workers' default isolation — see that runner's header comment — so
 * it stamps the DO connection attachment directly with the SAME `userId` a real upgrade would have
 * resolved from this exact cookie); `cookie` is what every `fetch` call authenticates with on
 * both runners. */
export interface Session {
  readonly userId: string;
  readonly cookie: string;
}

/** One open character-stream connection's client<->server surface — hello/append/collect-frames,
 * abstracted over a real `ws.WebSocket` (Node) or a mocked Hibernation-API pair driven through
 * `runInDurableObject` (Cloudflare; task-8-brief's pre-authorized fallback for WS under pool-
 * workers). */
export interface StreamDriver {
  /** Sends one client->server frame. Resolves once the frame has been fully processed server-side
   * (Node: once the underlying `ws.send` call returns; Cloudflare: once the awaited
   * `runInDurableObject`/`webSocketMessage` round-trip that processed it returns) — a scenario
   * never has to guess whether a `send` "landed" before calling `collect`. */
  send(msg: ClientMessage): Promise<void>;
  /** Waits until `stop` returns `true` for the frames received on this connection SO FAR (checked
   * immediately, then again after every newly-received frame), or until `timeoutMs` elapses —
   * whichever comes first — and resolves with whatever was collected. A timeout resolves rather
   * than rejects: the scenario's own assertion against a possibly-incomplete result is what
   * surfaces a failure, never a hung test. */
  collect(stop: (frames: readonly ServerMessage[]) => boolean, timeoutMs?: number): Promise<readonly ServerMessage[]>;
  /** Closes the underlying connection (Node: a real WS close; Cloudflare: a no-op — there is no
   * real socket to close under the mocked-pair fallback). */
  close(): void;
}

export interface OpenStreamArgs {
  readonly streamId: string;
  readonly session: Session;
  /** [plan-9 Task 10] The campaign-socket role to stamp (`camp:` streams only — design ruling 1:
   * `dm` if the session is this campaign's DM, else `member`). Node IGNORES this entirely: its
   * `openStream` drives the REAL `GET /api/campaigns/:id/ws` route, which resolves the role from
   * the session's own D1 membership row for real (design ruling 1's actual production code path,
   * matching this file's existing `char:` behavior of never trusting a caller-supplied role). The
   * Cloudflare runner's mocked-pair fallback has no real WS-upgrade route to resolve this FROM (see
   * `Session`'s own doc comment on that documented limitation, already true for `char:`'s hardcoded
   * `role: 'owner'`) — a campaign scenario MUST pass the role its own HTTP setup calls actually
   * established (`POST /api/campaigns` for `dm`, `POST /api/campaigns/join` for `member`), or the
   * mocked connection will be stamped with the wrong one. Ignored for `char:` streams (always
   * `owner`, unchanged). */
  readonly role?: 'owner' | 'dm' | 'member';
}

export interface ConformanceDriver {
  /** Black-box HTTP against the running adapter instance — Node: real `fetch` to an ephemeral-port
   * server; Cloudflare: `SELF.fetch` against the pool-workers-hosted Worker. `path` is an
   * absolute-from-root path (`/api/...`); `init` is passed through verbatim. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Opens a `StreamDriver` for `streamId`, acting as `session` — a scenario must only ever open a
   * stream `session` actually owns (see `Session`'s doc comment on the Cloudflare runner's
   * documented limitation: it does not re-verify ownership at this call the way a real WS upgrade
   * would, because it cannot perform a real upgrade at all under pool-workers). */
  openStream(args: OpenStreamArgs): Promise<StreamDriver>;
}

export interface Scenario {
  readonly name: string;
  readonly run: (driver: ConformanceDriver) => Promise<void>;
  /** [plan-9 Task 10] Omitted (every pre-plan-9 scenario) — runs on both adapters, unchanged. See
   * this file's header comment for exactly why a campaign scenario would ever need this. */
  readonly adapters?: readonly ('node' | 'cloudflare')[];
}

// --- shared fixtures ------------------------------------------------------------------------

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };

/** Deterministically maps an arbitrary (non-hex) scenario seed string to a valid lowercase hex
 * string of exactly `length` characters — `verifier`/`salt` must be STRICTLY `/^[0-9a-f]+$/`
 * (`verifier.ts`'s `isValidVerifierShape`/`isValidSalt`), which a plain repeated-seed string is
 * not (most scenario seeds, e.g. `'Quota'`, `'AppendReadHead'`, contain non-hex letters). Not
 * cryptographic — only needs to be stable per call site and shaped correctly. */
function toHex(seed: string, length: number): string {
  let out = '';
  for (let i = 0; out.length < length; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i;
    out += (code % 16).toString(16);
  }
  return out.slice(0, length);
}
function verifierHex(seed: string): string {
  return toHex(seed, 64); // 32 bytes, hex
}
function saltHex(seed: string): string {
  return toHex(seed, 32); // 16 bytes, hex
}

function firstCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('response carried no Set-Cookie header');
  const pair = setCookieHeader.split(';')[0];
  if (!pair) throw new Error('Set-Cookie header had no name=value pair');
  return pair;
}

/** ADR-012: usernames are capped at 32 Unicode chars — `seed` is truncated and the uniqueness
 * suffix kept short (base36 timestamp + a short random tail) so the combined result never risks
 * exceeding that cap regardless of how long a scenario's own `seed` string is. */
function uniqueUsername(seed: string): string {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  return `Cf${seed.slice(0, 10)}${suffix}`.slice(0, 32);
}

interface AuthedSession extends Session {
  readonly username: string;
  readonly recoveryCodes: readonly string[];
}

/** [plan-9 Task 10] A DETERMINISTIC, collision-free simulated IP, one per call — same
 * rationale/technique family `ipRateLimitScenario` already documents in full: Node ignores this
 * header entirely (harmless no-op there); the Cloudflare Worker trusts it (`worker.ts`'s
 * `stampClientIp`), and — unlike Node's fresh-boot-per-test isolation — this pool's `RateLimiterDO`
 * storage is shared across EVERY `it()` block in this ONE test file with no reset between them, all
 * otherwise landing in the SAME `cf-connecting-ip`-less "unknown" bucket. Plan-9's campaign
 * scenarios call `registerAndLogin` far more times per run than the pre-plan-9 suite ever did (a
 * 12-member-quota scenario alone registers 12 accounts) — without this, that shared
 * 30-requests/minute bucket empties into `429`s partway through the file (observed directly:
 * `register(...): expected 429 to be 201`, a pure harness accounting artifact, not a real product
 * rate-limit bug — every one of these accounts is a distinct real user in the test's own story,
 * never actually hammering the API from one IP).
 *
 * [fix round 1, Blocking] A RANDOM 1..254 last-octet (the original shape here) self-collides: this
 * file makes on the order of dozens of `registerAndLogin` calls per run (the 12-member-quota
 * scenario alone makes 13), and a 254-value space is a genuine birthday-paradox trap at that volume
 * — the reviewer measured ~1-in-4 CF runs hitting a real collision (two calls sharing one bucket,
 * tipping it past 30 and producing a REAL, if rare, `429`). A monotonic counter spread across THREE
 * octets (16,777,216 distinct addresses, `10.0.0.0/8` — any private/test-net range works, `stampClientIp`
 * never validates the value beyond using it as a bucket key verbatim) makes a same-run collision
 * structurally impossible for any realistic call count, which a probabilistic scheme can only ever
 * make unlikely. This pipeline merges unattended — the gate must be deterministic, not merely
 * "usually green". */
let simulatedIpCounter = 0;
function simulatedIp(): string {
  simulatedIpCounter += 1;
  const n = simulatedIpCounter;
  const b = (n >>> 16) & 0xff;
  const c = (n >>> 8) & 0xff;
  const d = n & 0xff;
  return `10.${b}.${c}.${d}`;
}

async function registerAndLogin(driver: ConformanceDriver, seed: string): Promise<AuthedSession> {
  const username = uniqueUsername(seed);
  const verifier = verifierHex(seed);
  const ip = simulatedIp();

  const registerRes = await driver.fetch('/api/auth/register', {
    method: 'POST',
    headers: { ...XRW, 'cf-connecting-ip': ip },
    body: JSON.stringify({ username, verifier, salt: saltHex(seed) }),
  });
  expect(registerRes.status, `register(${seed})`).toBe(201);
  const registerBody = (await registerRes.json()) as { userId: string; recoveryCodes: string[] };

  const loginRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: { ...XRW, 'cf-connecting-ip': ip },
    body: JSON.stringify({ username, verifier, deviceLabel: seed }),
  });
  expect(loginRes.status, `login(${seed})`).toBe(200);
  const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

  return { userId: registerBody.userId, cookie, username, recoveryCodes: registerBody.recoveryCodes };
}

async function createCharacter(driver: ConformanceDriver, session: Session, characterId: string): Promise<void> {
  const res = await driver.fetch('/api/characters', {
    method: 'POST',
    headers: { ...XRW, cookie: session.cookie },
    body: JSON.stringify({ id: characterId, name: 'Conformance Character', system: 'srd-5e-2024' }),
  });
  expect(res.status, 'create character').toBe(201);
}

function characterCreatedEvent(streamId: string, userId: string): Event {
  return {
    id: crypto.randomUUID(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId, deviceId: 'conformance-device', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Conformance Test',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
  };
}

/** A `note.added` event — the cheapest owner-allowed event type with a variable-size payload, used
 * both as ordinary filler (small `bodyBytes`, catch-up paging) and as quota-filling ballast (large
 * `bodyBytes`, up to `note.added`'s own 8192-char body cap — still comfortably under the 16 KB
 * per-event size cap `validate.ts` enforces once envelope overhead is added). */
function noteEvent(streamId: string, userId: string, bodyBytes = 8): Event {
  return {
    id: crypto.randomUUID(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId, deviceId: 'conformance-device', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: crypto.randomUUID(), body: 'x'.repeat(bodyBytes) },
  };
}

// --- campaign fixtures (plan-9 Task 10) ---------------------------------------------------

interface CampaignDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly role: 'dm' | 'player';
  readonly joinCode?: string;
}

/** `POST /api/campaigns`'s own response is ALWAYS to the creating DM (`toCampaignDto`'s doc
 * comment: `joinCode` is omitted only for a non-DM's view via `GET /` — never for the creator's own
 * create response) — narrowed to a required `joinCode` here so every call site doesn't need its own
 * `string | undefined` guard for a value that is, in practice, always present at this call site. */
interface CreatedCampaignDto extends CampaignDto {
  readonly joinCode: string;
}

async function createCampaignHttp(
  driver: ConformanceDriver,
  dm: Session,
  campaignId: string,
): Promise<CreatedCampaignDto> {
  const res = await driver.fetch('/api/campaigns', {
    method: 'POST',
    headers: { ...XRW, cookie: dm.cookie },
    body: JSON.stringify({
      id: campaignId,
      name: 'Conformance Campaign',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
    }),
  });
  expect(res.status, 'create campaign').toBe(201);
  const body = (await res.json()) as CampaignDto;
  expect(body.joinCode, 'the create response always carries a joinCode for the creating DM').toBeTruthy();
  return body as CreatedCampaignDto;
}

async function joinCampaignHttp(
  driver: ConformanceDriver,
  session: Session,
  code: string,
  displayName?: string,
): Promise<{ readonly status: number; readonly campaignId?: string }> {
  const res = await driver.fetch('/api/campaigns/join', {
    method: 'POST',
    headers: { ...XRW, cookie: session.cookie },
    body: JSON.stringify({ code, ...(displayName !== undefined ? { displayName } : {}) }),
  });
  const body = res.status === 200 ? ((await res.json()) as { campaignId: string }) : undefined;
  return { status: res.status, campaignId: body?.campaignId };
}

/** A campaign-stream event with a placeholder envelope `actor` (ignored server-side — `stampActor`,
 * `stream-actor.ts`, overwrites `userId`/`role` from the REAL connection identity before storing;
 * only `deviceId` survives from the client-sent envelope, same precedent this file's existing
 * `characterCreatedEvent`/`noteEvent` helpers already rely on). */
function campaignEvent(
  streamId: string,
  type: string,
  v: number,
  payload: unknown,
  placeholderUserId: string,
  placeholderRole: 'owner' | 'dm' | 'member',
): Event {
  return {
    id: crypto.randomUUID(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: placeholderUserId, deviceId: 'conformance-device', role: placeholderRole },
    type,
    v,
    payload,
  };
}

function rollLoggedEvent(streamId: string, visibility: 'everyone' | 'dm' | 'private', label: string): Event {
  return campaignEvent(
    streamId,
    'roll.logged',
    1,
    {
      label,
      formula: '1d20',
      results: [{ die: 'd20', value: 12 }],
      total: 12,
      kind: 'check',
      visibility,
    },
    'ignored-by-server',
    'dm',
  );
}

function chatMessageEvent(streamId: string, text: string, visibility: 'everyone' | 'dm' | 'private'): Event {
  return campaignEvent(streamId, 'chat.message', 1, { text, visibility }, 'ignored-by-server', 'member');
}

function dmNoteAddedEvent(streamId: string): Event {
  return campaignEvent(
    streamId,
    'dm.note_added',
    1,
    { id: crypto.randomUUID(), title: 'Secret', body: 'DM only' },
    'ignored-by-server',
    'dm',
  );
}

interface AckResult {
  readonly id: string;
  readonly seq: number;
}
interface RejectResult {
  readonly id: string;
  readonly code: RejectCode;
  readonly message: string;
}

function isAckOrReject(msg: ServerMessage, rid: string): msg is AckMsg | RejectMsg {
  return (msg.t === 'ack' || msg.t === 'reject') && msg.rid === rid;
}

/** Sends one `append` and waits until every one of `events`' outcomes has arrived (an `append` can
 * split across a SEPARATE `ack` frame and a SEPARATE `reject` frame for the same `rid` — doc-03 —
 * so this waits for the combined result COUNT to reach `events.length`, not for either frame type
 * alone). Returns the combined acked/rejected results, keyed the same way `StreamActor.append`
 * returns them. */
async function appendAndWait(
  stream: StreamDriver,
  events: readonly Event[],
): Promise<{ acked: readonly AckResult[]; rejected: readonly RejectResult[] }> {
  const rid = crypto.randomUUID();
  await stream.send({ t: 'append', rid, events: events as Event[] });

  const frames = await stream.collect((buf) => {
    const relevant = buf.filter((f): f is AckMsg | RejectMsg => isAckOrReject(f, rid));
    const total = relevant.reduce((sum, f) => sum + f.results.length, 0);
    return total >= events.length;
  }, 10_000);

  const relevant = frames.filter((f): f is AckMsg | RejectMsg => isAckOrReject(f, rid));
  const acked = relevant.filter((f): f is AckMsg => f.t === 'ack').flatMap((f) => f.results);
  const rejected = relevant.filter((f): f is RejectMsg => f.t === 'reject').flatMap((f) => f.results);
  return { acked, rejected };
}

function isWelcomeFor(msg: ServerMessage, rid: string): msg is WelcomeMsg {
  return msg.t === 'welcome' && msg.rid === rid;
}
function isEventsFor(msg: ServerMessage, streamId: string): msg is EventsMsg {
  return msg.t === 'events' && msg.stream === streamId;
}

async function sendHello(stream: StreamDriver, streamId: string, lastSeq: number): Promise<{ rid: string }> {
  const rid = crypto.randomUUID();
  await stream.send({
    t: 'hello',
    rid,
    proto: 1,
    app: 'conformance',
    streams: [{ id: streamId, lastSeq }],
    have: [],
    pending: [],
  });
  return { rid };
}

// --- scenarios -------------------------------------------------------------------------------

/** Full auth lifecycle: register -> salt (known + no-existence-oracle unknown) -> login ->
 * wrong-verifier 401 -> reset (burns a recovery code, rotates credentials, kills every session) ->
 * lockout (5 failures pass through as 401, the 6th is blocked as 429 — ADR-012's exact curve). */
async function authLifecycleScenario(driver: ConformanceDriver): Promise<void> {
  const seed = 'Lifecycle';
  const username = uniqueUsername(seed);
  const verifier = verifierHex(seed);
  const salt = saltHex(seed);

  const registerRes = await driver.fetch('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt }),
  });
  expect(registerRes.status, 'register').toBe(201);
  const { recoveryCodes } = (await registerRes.json()) as { userId: string; recoveryCodes: string[] };
  expect(recoveryCodes, 'six recovery codes issued once').toHaveLength(6);

  const knownSaltRes = await driver.fetch(`/api/auth/salt?username=${encodeURIComponent(username)}`);
  expect(knownSaltRes.status).toBe(200);
  const { salt: knownSalt } = (await knownSaltRes.json()) as { salt: string };
  expect(knownSalt, 'salt endpoint returns the REGISTERED salt for a known user').toBe(salt.toLowerCase());

  const unknownSaltRes = await driver.fetch(`/api/auth/salt?username=${encodeURIComponent(username)}-does-not-exist`);
  expect(unknownSaltRes.status, 'no existence oracle: unknown username is still 200').toBe(200);
  const { salt: unknownSalt } = (await unknownSaltRes.json()) as { salt: string };
  expect(unknownSalt, 'fake salt has the SAME shape as a real one').toMatch(/^[0-9a-f]{32}$/i);

  const loginRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel: 'lifecycle' }),
  });
  expect(loginRes.status, 'login (correct verifier)').toBe(200);
  const firstCookie = firstCookiePair(loginRes.headers.get('set-cookie'));

  const wrongVerifier = verifierHex('WrongOne');
  const wrongLoginRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier: wrongVerifier, deviceLabel: 'lifecycle' }),
  });
  expect(wrongLoginRes.status, 'login (wrong verifier) -> 401').toBe(401);

  const newVerifier = verifierHex('NewVerif');
  const newSalt = saltHex('NewSalt0');
  const resetRes = await driver.fetch('/api/auth/reset', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, recoveryCode: recoveryCodes[0], newSalt, newVerifier }),
  });
  expect(resetRes.status, 'reset with a valid recovery code').toBe(200);

  const meWithOldCookie = await driver.fetch('/api/me', { headers: { cookie: firstCookie } });
  expect(meWithOldCookie.status, 'reset burns EVERY session, including the pre-reset one').toBe(401);

  const oldVerifierAfterResetRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel: 'lifecycle' }),
  });
  expect(oldVerifierAfterResetRes.status, 'the OLD verifier no longer works after reset').toBe(401);

  const newLoginRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier: newVerifier, deviceLabel: 'lifecycle' }),
  });
  expect(newLoginRes.status, 'the NEW verifier works after reset').toBe(200);

  // Lockout: a FRESH account, so this account's own `user:<folded>:login-fail` rate-limit scope
  // starts clean (the wrong-verifier/reset checks above already put 2 failed attempts through the
  // FIRST account's scope, which would otherwise throw the boundary off by those 2 hits).
  const lockoutAccount = await registerAndLogin(driver, 'LifecycleLockout');
  const lockoutWrongVerifier = verifierHex('WrongTwo');
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await driver.fetch('/api/auth/login', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({
        username: lockoutAccount.username,
        verifier: lockoutWrongVerifier,
        deviceLabel: 'lifecycle',
      }),
    });
    statuses.push(res.status);
  }
  expect(statuses, 'login-fail lockout curve: 5 failures pass as 401, the 6th is 429').toEqual([
    401, 401, 401, 401, 401, 429,
  ]);
  // Whole-branch review finding 2 ("an active lockout also blocks the CORRECT verifier") is
  // deliberately NOT re-asserted here with an extra HTTP call: this whole conformance FILE shares
  // one fixed `ip:<ip>:auth` rate-limit budget (30 requests/min, `core/http/rate-limit.ts`) across
  // EVERY scenario in the table below, with no reset between them — verified at execution time
  // that one more `driver.fetch` call here tips a LATER scenario's own login over that shared
  // budget (429 where it expected 200), a real cross-scenario coupling this finding's fix must not
  // introduce. Finding 2 is covered end-to-end instead by: `test/core/auth.test.ts`'s dedicated
  // describe block (Node, the real `MemoryRateLimit` adapter, HTTP-level) and
  // `test/adapters/cloudflare/rate-limiter-do.test.ts` (Cloudflare, `RateLimiterDO.peek` directly,
  // no shared IP budget).
}

/** append -> ack with contiguous seqs; a fresh `hello` reads them back in order (catch-up "events"
 * frames) and reports the same head via `welcome.streams[0].headSeq` — doc-10's "append/read/head"
 * row, exercised entirely through the sync-protocol surface (there is no separate HTTP read/head
 * endpoint for stream contents; `welcome`/`events` ARE the read/head surface). */
async function appendReadHeadScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'AppendReadHead');
  const characterId = crypto.randomUUID();
  const streamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);
  const writer = await driver.openStream({ streamId, session: owner });

  const events = [
    characterCreatedEvent(streamId, owner.userId),
    noteEvent(streamId, owner.userId),
    noteEvent(streamId, owner.userId),
  ];
  const outcome = await appendAndWait(writer, events);
  expect(outcome.rejected, 'no rejections appending 3 well-formed owner events').toEqual([]);
  expect(
    outcome.acked.map((a) => a.seq).sort((a, b) => a - b),
    'contiguous seqs starting at 1',
  ).toEqual([1, 2, 3]);
  writer.close();

  const reader = await driver.openStream({ streamId, session: owner });
  const { rid } = await sendHello(reader, streamId, 0);
  const frames = await reader.collect((buf) => {
    const gotWelcome = buf.some((f) => isWelcomeFor(f, rid));
    const gotEvents = buf
      .filter((f): f is EventsMsg => isEventsFor(f, streamId))
      .reduce((s, f) => s + f.events.length, 0);
    return gotWelcome && gotEvents >= 3;
  });

  const welcome = frames.find((f): f is WelcomeMsg => isWelcomeFor(f, rid));
  expect(welcome?.streams[0]?.headSeq, 'head, via a fresh welcome').toBe(3);

  const readBack = frames.filter((f): f is EventsMsg => isEventsFor(f, streamId)).flatMap((f) => f.events);
  expect(
    readBack.map((e) => e.id),
    'read-back events are the SAME ones, same order',
  ).toEqual(events.map((e) => e.id));
  expect(readBack.map((e) => e.seq)).toEqual([1, 2, 3]);
  reader.close();
}

/** Owner-only permissions (doc-03 §Permission enforcement: "Direct solo sockets only allow the
 * owner role"): a second, unrelated account can never even obtain the WS handoff for a character it
 * doesn't own. Deliberately `fetch`-only (no stream needed) — `core/routes/characters.ts`'s `GET
 * /:id/ws` route runs the ownership check BEFORE the `Origin` check and BEFORE ever touching
 * `WsUpgrade`, so a plain non-upgrade request already exercises the exact code path a real socket
 * attempt would hit, identically on both adapters. */
async function ownerOnlyScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'Owner');
  const intruder = await registerAndLogin(driver, 'Intruder');
  const characterId = crypto.randomUUID();
  await createCharacter(driver, owner, characterId);

  const res = await driver.fetch(`/api/characters/${characterId}/ws`, { headers: { cookie: intruder.cookie } });
  expect(res.status, 'a non-owner is refused the WS handoff outright').toBe(403);
}

/** Quota warning (80%) then reject (100%) — doc-08's PER-STREAM 2 MB/20,000-event cap. Filled with
 * large `note.added` events (8000-byte bodies, ~8.2 KB on the wire once the envelope is added —
 * comfortably under the 16 KB per-event cap) through the ordinary public append path: ~254 events
 * cross 2 MB, well within the 50-events-per-append/50 KB-ish frame limits, so this needs only a
 * handful of real appends rather than any direct-store seeding shortcut.
 *
 * BATCH_SIZE is 12 (not the protocol's own 50-events-per-append ceiling) — whole-branch review
 * finding 1: doc-08's OTHER cap, the 128 KB WS-message cap (`core/validate.ts`'s
 * `WS_MESSAGE_BYTES_MAX`), is now actually enforced (Node's `ws` `maxPayload`, Cloudflare's
 * `CharacterStreamDO.webSocketMessage` length guard) — 50 * ~8.2 KB ≈ 410 KB would have blown
 * straight through that cap and gotten this scenario's OWN connection closed 1009 mid-run
 * (verified RED against the pre-fix 50-per-batch shape: the append never acks/rejects, and
 * `appendAndWait` times out waiting on a socket that no longer exists). 12 * ~8.2 KB ≈ 98 KB
 * comfortably clears the frame under the cap with margin for JSON envelope overhead. */
async function quotaScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'Quota');
  const characterId = crypto.randomUUID();
  const streamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);
  const stream = await driver.openStream({ streamId, session: owner });

  const created = await appendAndWait(stream, [characterCreatedEvent(streamId, owner.userId)]);
  expect(created.rejected).toEqual([]);

  let sawQuotaReject = false;
  const BATCH_SIZE = 12; // ~98 KB/frame — see this function's doc comment on the 128 KB WS cap.
  const MAX_BATCHES = 30; // 30 * 12 * ~8.2KB =~ 2.95MB — more than enough headroom over the 2MB cap.
  for (let batch = 0; batch < MAX_BATCHES && !sawQuotaReject; batch += 1) {
    const events = Array.from({ length: BATCH_SIZE }, () => noteEvent(streamId, owner.userId, 8000));
    const outcome = await appendAndWait(stream, events);
    if (outcome.rejected.some((r) => r.code === 'quota')) sawQuotaReject = true;
  }
  expect(sawQuotaReject, 'an append eventually gets rejected with code "quota" once the stream fills').toBe(true);

  const allFrames = await stream.collect(() => true, 0);
  const sawWarning = allFrames.some((f) => f.t === 'notice' && f.key === 'quota.warning');
  expect(sawWarning, 'a notice quota.warning fired before the stream filled (80% crossing)').toBe(true);

  stream.close();
}

/** Dedupe idempotence: re-appending an event with an id already committed acks it with its
 * EXISTING seq — no new event is stored (doc-03: "duplicates (same event id) are acked with the
 * existing seq"). */
async function dedupeScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'Dedupe');
  const characterId = crypto.randomUUID();
  const streamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);
  const stream = await driver.openStream({ streamId, session: owner });

  const created = characterCreatedEvent(streamId, owner.userId);
  const first = await appendAndWait(stream, [created]);
  expect(first.rejected).toEqual([]);
  expect(first.acked).toHaveLength(1);
  const originalSeq = first.acked[0]?.seq;
  expect(typeof originalSeq).toBe('number');

  const retry = await appendAndWait(stream, [created]);
  expect(retry.rejected, 'a retry of an already-committed id is never rejected').toEqual([]);
  expect(retry.acked, 'a retry is acked with the EXISTING seq, not a new one').toEqual([
    { id: created.id, seq: originalSeq },
  ]);

  stream.close();
}

/** Tx atomicity: a `txId` group commits or rejects as ONE unit (doc-03 §Ordering). Both halves: a
 * group with an invalid member rejects EVERY member (code `invalid`, nothing stored); a fully-valid
 * group commits with contiguous seqs. */
async function txAtomicityScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'Tx');
  const characterId = crypto.randomUUID();
  const streamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);
  const stream = await driver.openStream({ streamId, session: owner });

  const seed = await appendAndWait(stream, [characterCreatedEvent(streamId, owner.userId)]);
  expect(seed.rejected).toEqual([]);

  // Half 1: one bad member (payload.id fails NoteAddedV1's UUID regex) poisons the whole group.
  const txId = crypto.randomUUID();
  const good = { ...noteEvent(streamId, owner.userId), txId };
  const bad: Event = { ...noteEvent(streamId, owner.userId), txId, payload: { id: 'not-a-uuid' } };

  const poisoned = await appendAndWait(stream, [good, bad]);
  expect(poisoned.acked, 'nothing in a poisoned txId group is ever acked').toEqual([]);
  const rejectedById = new Map(poisoned.rejected.map((r) => [r.id, r] as const));
  expect(rejectedById.get(good.id)?.code, 'the otherwise-good member is rejected too (group casualty)').toBe('invalid');
  expect(rejectedById.get(bad.id)?.code, 'the actually-bad member keeps a reject code').toBe('invalid');

  // A fresh hello proves NOTHING from the poisoned group was stored: head is still 1.
  const verifyReader = await driver.openStream({ streamId, session: owner });
  const { rid: verifyRid } = await sendHello(verifyReader, streamId, 0);
  const verifyFrames = await verifyReader.collect((buf) => buf.some((f) => isWelcomeFor(f, verifyRid)));
  const verifyWelcome = verifyFrames.find((f): f is WelcomeMsg => isWelcomeFor(f, verifyRid));
  expect(verifyWelcome?.streams[0]?.headSeq, 'a poisoned txId group commits NOTHING').toBe(1);
  verifyReader.close();

  // Half 2: a fully-good txId group commits atomically, with contiguous seqs.
  const txId2 = crypto.randomUUID();
  const goodA = { ...noteEvent(streamId, owner.userId), txId: txId2 };
  const goodB = { ...noteEvent(streamId, owner.userId), txId: txId2 };
  const committed = await appendAndWait(stream, [goodA, goodB]);
  expect(committed.rejected, 'a fully-valid txId group is never partially rejected').toEqual([]);
  const seqA = committed.acked.find((a) => a.id === goodA.id)?.seq;
  const seqB = committed.acked.find((a) => a.id === goodB.id)?.seq;
  expect(typeof seqA).toBe('number');
  expect(seqB, 'a fully-valid txId group commits with contiguous seqs').toBe((seqA ?? 0) + 1);

  stream.close();
}

/** hello/catch-up paging: a 450-event stream pages catch-up in ≤200-event `events` frames — doc-03
 * §Catch-up performance: "200 events per frame" — so 450 events must page as exactly 200/200/50. */
async function catchUpPagingScenario(driver: ConformanceDriver): Promise<void> {
  const owner = await registerAndLogin(driver, 'Page');
  const characterId = crypto.randomUUID();
  const streamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);

  const writer = await driver.openStream({ streamId, session: owner });
  const seeded = await appendAndWait(writer, [characterCreatedEvent(streamId, owner.userId)]);
  expect(seeded.rejected).toEqual([]);

  const TOTAL = 450;
  let sent = 1; // character.created above already counts as event #1.
  while (sent < TOTAL) {
    const batchSize = Math.min(50, TOTAL - sent);
    const events = Array.from({ length: batchSize }, () => noteEvent(streamId, owner.userId, 8));
    const outcome = await appendAndWait(writer, events);
    expect(outcome.rejected, `no rejections while seeding the 450-event stream (at ${sent})`).toEqual([]);
    sent += batchSize;
  }
  writer.close();

  const reader = await driver.openStream({ streamId, session: owner });
  const { rid } = await sendHello(reader, streamId, 0);
  const frames = await reader.collect((buf) => {
    const total = buf.filter((f): f is EventsMsg => isEventsFor(f, streamId)).reduce((s, f) => s + f.events.length, 0);
    return total >= TOTAL;
  }, 15_000);

  const eventsFrames = frames.filter((f): f is EventsMsg => isEventsFor(f, streamId));
  expect(
    eventsFrames.map((f) => f.events.length),
    '450 events page as exactly 200/200/50, in that order',
  ).toEqual([200, 200, 50]);

  const welcome = frames.find((f): f is WelcomeMsg => isWelcomeFor(f, rid));
  expect(welcome?.streams[0]?.headSeq, 'welcome.headSeq matches the full 450-event head').toBe(TOTAL);
  reader.close();
}

/** Rate limits: the per-IP auth cap (ADR-012: 30 requests/minute/IP across `/api/auth/*`) — the
 * 30th request in a rolling minute still succeeds, the 31st is blocked with 429. Every request
 * carries a `cf-connecting-ip` header with a value unique to THIS scenario run: the Node adapter
 * ignores it entirely (it always overwrites `X-Hk-Client-Ip` from the real loopback socket address
 * — `server.ts`'s `stampClientIp` — so this is a harmless no-op there, and Node's per-test fresh
 * server boot already isolates its `MemoryRateLimit` from every other scenario). The Cloudflare
 * Worker DOES trust it (`worker.ts`'s `stampClientIp`), and — unlike the Node runner's fresh-boot-
 * per-test isolation — this pool's `RateLimiterDO` storage is NOT reliably isolated between
 * separate `it()` blocks within one test file (verified empirically: without a distinguishing
 * header here, this scenario inherited hits already accumulated by every EARLIER scenario's own
 * `/api/auth/*` calls, which all default to the same `cf-connecting-ip`-less "unknown" bucket) —
 * a fresh, never-before-used simulated IP per run is what actually isolates this scenario's own
 * 30/31-request boundary from that shared state, on both runners, honestly (no direct store
 * access; still exercising the real header-driven trust boundary each adapter documents). */
async function ipRateLimitScenario(driver: ConformanceDriver): Promise<void> {
  const probeSeed = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const simulatedIp = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
  const statuses: number[] = [];
  for (let i = 0; i < 31; i += 1) {
    const res = await driver.fetch(`/api/auth/salt?username=conf-rate-probe-${probeSeed}-${i}`, {
      headers: { 'cf-connecting-ip': simulatedIp },
    });
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 30), 'the first 30 requests in the window all succeed').toEqual(
    Array.from({ length: 30 }, () => 200),
  );
  expect(statuses[30], 'the 31st request in the same window is blocked').toBe(429);
}

// --- campaign scenarios (plan-9 Task 10) ----------------------------------------------------

/** Lifecycle: create -> list (dm-of/member-of, joinCode never leaks to a non-DM) -> join by code
 * -> rotate-code (the OLD code stops working, the NEW one works) -> DM removes a member -> the
 * removed member's WS reconnect is refused outright (mirrors `ownerOnlyScenario`'s "no upgrade
 * needed" technique: `GET /:id/ws` checks membership BEFORE ever touching `WsUpgrade`). Every
 * assertion here is plain `fetch` — no WS needed at all, so this scenario needs no `adapters`
 * restriction. */
async function campaignLifecycleScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampLifeDm');
  const member = await registerAndLogin(driver, 'CampLifeMember');
  const campaignId = crypto.randomUUID();

  const created = await createCampaignHttp(driver, dm, campaignId);
  expect(created.joinCode, 'a joinCode is issued to the DM').toBeTruthy();

  const dmList = (await (
    await driver.fetch('/api/campaigns', { headers: { cookie: dm.cookie } })
  ).json()) as CampaignDto[];
  expect(
    dmList.some((c) => c.id === campaignId && c.role === 'dm'),
    'the DM sees their own campaign',
  ).toBe(true);

  const joined = await joinCampaignHttp(driver, member, created.joinCode);
  expect(joined.status, 'join by code').toBe(200);
  expect(joined.campaignId).toBe(campaignId);

  const memberList = (await (
    await driver.fetch('/api/campaigns', { headers: { cookie: member.cookie } })
  ).json()) as CampaignDto[];
  const memberEntry = memberList.find((c) => c.id === campaignId);
  expect(memberEntry?.role, 'a member sees their own campaign, role player').toBe('player');
  expect(memberEntry?.joinCode, 'joinCode never leaks to a non-DM').toBeUndefined();

  const rotateRes = await driver.fetch(`/api/campaigns/${campaignId}/rotate-code`, {
    method: 'POST',
    headers: { ...XRW, cookie: dm.cookie },
  });
  expect(rotateRes.status, 'DM rotates the join code').toBe(200);
  const rotated = (await rotateRes.json()) as { joinCode: string };
  expect(rotated.joinCode).not.toBe(created.joinCode);

  const late = await registerAndLogin(driver, 'CampLifeLate');
  const oldCodeJoin = await joinCampaignHttp(driver, late, created.joinCode);
  expect(oldCodeJoin.status, 'the OLD join code no longer works after rotation').toBe(404);
  const newCodeJoin = await joinCampaignHttp(driver, late, rotated.joinCode);
  expect(newCodeJoin.status, 'the NEW join code works').toBe(200);

  const removeRes = await driver.fetch(`/api/campaigns/${campaignId}/members/${late.userId}`, {
    method: 'DELETE',
    headers: { ...XRW, cookie: dm.cookie },
  });
  expect(removeRes.status, 'DM removes a member').toBe(204);

  const reconnectRes = await driver.fetch(`/api/campaigns/${campaignId}/ws`, { headers: { cookie: late.cookie } });
  expect(reconnectRes.status, 'a removed member is refused the WS handoff outright').toBe(403);
}

/** [gap (a)] "a member-role action driven to SUCCESS through the REAL adapter surface on BOTH
 * adapters" — the exact root-cause class Task 8's own required Node e2e caught in production
 * (`campaign-permissions.ts` never wired into either adapter's `CampaignActor` construction, so
 * every real member join/append would have 500'd): a real member, joined via the real HTTP route,
 * opens the campaign WS and appends a member-permitted event through it. */
async function campaignMemberWriteScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampWriteDm');
  const member = await registerAndLogin(driver, 'CampWriteMember');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  const created = await createCampaignHttp(driver, dm, campaignId);
  const joined = await joinCampaignHttp(driver, member, created.joinCode);
  expect(joined.status).toBe(200);

  const memberStream = await driver.openStream({ streamId, session: member, role: 'member' });
  const { rid } = await sendHello(memberStream, streamId, 0);
  const helloFrames = await memberStream.collect((buf) => buf.some((f) => isWelcomeFor(f, rid)));
  const welcome = helloFrames.find((f): f is WelcomeMsg => isWelcomeFor(f, rid));
  expect(welcome?.streams[0]?.id, 'welcome names the campaign stream').toBe(streamId);

  const chat = chatMessageEvent(streamId, 'hi from a real member', 'everyone');
  const outcome = await appendAndWait(memberStream, [chat]);
  expect(outcome.rejected, 'a genuinely member-role actor succeeds through the real adapter surface').toEqual([]);
  expect(outcome.acked).toHaveLength(1);
  memberStream.close();
}

/** doc-08's read-filtering rules, exercised through CATCH-UP (not live fan-out — `filterForConnection`
 * gates both identically, `campaign-actor.ts`'s own doc comment, so this needs only one connection
 * per reader, portable to both adapters): `roll.logged`/`chat.message` `visibility: 'dm'` reach the
 * DM and the sender; `'private'` reaches the SENDER ONLY (not even the DM); `dm.note_*` never
 * reaches a non-DM connection; `'everyone'` reaches everybody. */
async function campaignVisibilityScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampVisDm');
  const member = await registerAndLogin(driver, 'CampVisMember');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  const created = await createCampaignHttp(driver, dm, campaignId);
  const joined = await joinCampaignHttp(driver, member, created.joinCode);
  expect(joined.status).toBe(200);

  const dmWriter = await driver.openStream({ streamId, session: dm, role: 'dm' });
  const rollDm = rollLoggedEvent(streamId, 'dm', 'Secret initiative');
  const rollPrivateDm = rollLoggedEvent(streamId, 'private', 'DM private roll');
  const note = dmNoteAddedEvent(streamId);
  const dmBatch = await appendAndWait(dmWriter, [rollDm, rollPrivateDm, note]);
  expect(dmBatch.rejected, 'dm-authored visibility events all accepted').toEqual([]);
  dmWriter.close();

  const memberWriter = await driver.openStream({ streamId, session: member, role: 'member' });
  const rollPrivateMember = rollLoggedEvent(streamId, 'private', 'Member private roll');
  const chatDm = chatMessageEvent(streamId, 'psst dm only', 'dm');
  const chatEveryone = chatMessageEvent(streamId, 'hello table', 'everyone');
  const memberBatch = await appendAndWait(memberWriter, [rollPrivateMember, chatDm, chatEveryone]);
  expect(memberBatch.rejected, 'member-authored visibility events all accepted').toEqual([]);
  memberWriter.close();

  async function catchUpIds(session: Session, role: 'dm' | 'member', expectedCount: number): Promise<Set<string>> {
    const reader = await driver.openStream({ streamId, session, role });
    const { rid } = await sendHello(reader, streamId, 0);
    const frames = await reader.collect((buf) => {
      const gotWelcome = buf.some((f) => isWelcomeFor(f, rid));
      const total = buf
        .filter((f): f is EventsMsg => isEventsFor(f, streamId))
        .reduce((s, f) => s + f.events.length, 0);
      return gotWelcome && total >= expectedCount;
    }, 10_000);
    const ids = new Set(
      frames.filter((f): f is EventsMsg => isEventsFor(f, streamId)).flatMap((f) => f.events.map((e) => e.id)),
    );
    reader.close();
    return ids;
  }

  const dmVisible = [rollDm.id, rollPrivateDm.id, note.id, chatDm.id, chatEveryone.id];
  const dmSeen = await catchUpIds(dm, 'dm', dmVisible.length);
  for (const id of dmVisible) expect(dmSeen.has(id), `dm sees ${id}`).toBe(true);
  expect(
    dmSeen.has(rollPrivateMember.id),
    "dm does NOT see the member's private roll (private = roller only, not even the dm)",
  ).toBe(false);

  const memberVisible = [rollPrivateMember.id, chatDm.id, chatEveryone.id];
  const memberSeen = await catchUpIds(member, 'member', memberVisible.length);
  for (const id of memberVisible) expect(memberSeen.has(id), `member sees ${id}`).toBe(true);
  expect(memberSeen.has(rollDm.id), 'member does not see a dm-visibility roll they did not author').toBe(false);
  expect(memberSeen.has(rollPrivateDm.id), "member does not see the dm's private roll").toBe(false);
  expect(memberSeen.has(note.id), 'member never sees dm.note_added').toBe(false);
}

/** [Global Constraints "gateway forward+re-check"/"mirror verification"] A campaign MEMBER (not the
 * DM) owns a character, links it to the campaign on the character's own socket
 * (`character.campaign_joined`), mirrors the join on the campaign socket (accepted only because
 * `Rpc.currentCampaignOf`'s real cross-actor read confirms the live link — `verifyCharacterMirror`),
 * then forwards an owner-class event to the character THROUGH the campaign gateway
 * (`mapGatewayActor`'s `owner` branch) — verified to have genuinely committed on the character
 * stream's OWN storage via a fresh read, not merely acked locally. */
async function campaignGatewayMirrorScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampGwDm');
  const owner = await registerAndLogin(driver, 'CampGwOwner');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  const created = await createCampaignHttp(driver, dm, campaignId);
  const joined = await joinCampaignHttp(driver, owner, created.joinCode);
  expect(joined.status).toBe(200);

  const characterId = crypto.randomUUID();
  const charStreamId = `char:${characterId}`;
  await createCharacter(driver, owner, characterId);

  const charStream = await driver.openStream({ streamId: charStreamId, session: owner });
  const charCreated = characterCreatedEvent(charStreamId, owner.userId);
  const charJoined = campaignEvent(charStreamId, 'character.campaign_joined', 1, { campaignId }, owner.userId, 'owner');
  const charOutcome = await appendAndWait(charStream, [charCreated, charJoined]);
  expect(charOutcome.rejected, 'character.created + character.campaign_joined both accepted').toEqual([]);
  charStream.close();

  const campStream = await driver.openStream({ streamId, session: owner, role: 'member' });
  const mirrorJoin = campaignEvent(
    streamId,
    'campaign.character_joined',
    1,
    { characterId, ownerId: owner.userId, name: 'Conformance Character' },
    owner.userId,
    'member',
  );
  const mirrorOutcome = await appendAndWait(campStream, [mirrorJoin]);
  expect(mirrorOutcome.rejected, 'campaign.character_joined mirror-verified via a real cross-actor Rpc read').toEqual(
    [],
  );

  const forwardedNote = noteEvent(charStreamId, owner.userId, 8);
  const forwardOutcome = await appendAndWait(campStream, [forwardedNote]);
  expect(forwardOutcome.rejected, 'gateway-forwarded owner-class event accepted (owner mapping)').toEqual([]);
  campStream.close();

  const verifyReader = await driver.openStream({ streamId: charStreamId, session: owner });
  const { rid } = await sendHello(verifyReader, charStreamId, 0);
  const frames = await verifyReader.collect((buf) => {
    const gotWelcome = buf.some((f) => isWelcomeFor(f, rid));
    const total = buf
      .filter((f): f is EventsMsg => isEventsFor(f, charStreamId))
      .reduce((s, f) => s + f.events.length, 0);
    return gotWelcome && total >= 3; // created + campaign_joined + the gateway-forwarded note
  });
  const readBackIds = frames
    .filter((f): f is EventsMsg => isEventsFor(f, charStreamId))
    .flatMap((f) => f.events.map((e) => e.id));
  expect(readBackIds, 'the gateway-forwarded event genuinely landed on the character stream storage').toContain(
    forwardedNote.id,
  );
  verifyReader.close();
}

/** [gap (d)] "Rpc.hasEvent/currentCampaignOf parity on a fresh/untouched stream (both adapters, same
 * observable outcome)" — expressed black-box: a mirror join against a character stream that was
 * NEVER created/joined-anywhere must be rejected identically on both adapters (`currentCampaignOf`
 * reads `undefined` on a stream neither adapter has ever written to; `undefined !== thisCampaignId`
 * on both). */
async function campaignMirrorFreshStreamScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampMirrorFreshDm');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  await createCampaignHttp(driver, dm, campaignId);

  const characterId = crypto.randomUUID(); // never created, never touched by any stream.
  const campStream = await driver.openStream({ streamId, session: dm, role: 'dm' });
  const mirrorJoin = campaignEvent(
    streamId,
    'campaign.character_joined',
    1,
    { characterId, ownerId: dm.userId, name: 'Ghost' },
    dm.userId,
    'dm',
  );
  const outcome = await appendAndWait(campStream, [mirrorJoin]);
  expect(outcome.acked, 'a mirror join against a fresh/untouched character stream is never acked').toEqual([]);
  expect(
    outcome.rejected[0]?.code,
    'Rpc.currentCampaignOf on an untouched stream reads undefined identically on both adapters, so the mirror fails the same way',
  ).toBe('invalid');
  campStream.close();
}

/** [gap (b)] Owner-forgery at the gateway boundary, two shapes: (1) a campaign MEMBER attempts an
 * owner-role action on a character they do NOT own — refused (`mapGatewayActor`'s `owner` branch
 * requires the payload's real owner to match the acting member); (2) a FOREIGN campaign's DM
 * attempts to reach a character never joined to THEIR OWN campaign — refused (`mapGatewayActor`'s
 * `dm` branch requires `meta.characters.has(characterId)` scoped to THIS campaign, fix round 1's
 * Critical 1). Both prove the campaign gateway is the FIRST enforcement point: nothing is forwarded
 * to the character stream's own pipeline at all for either forgery attempt. */
async function campaignForgeryScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampForgeDm');
  const memberA = await registerAndLogin(driver, 'CampForgeMemberA');
  const memberB = await registerAndLogin(driver, 'CampForgeMemberB');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  const created = await createCampaignHttp(driver, dm, campaignId);
  expect((await joinCampaignHttp(driver, memberA, created.joinCode)).status).toBe(200);
  expect((await joinCampaignHttp(driver, memberB, created.joinCode)).status).toBe(200);

  const characterId = crypto.randomUUID();
  const charStreamId = `char:${characterId}`;
  await createCharacter(driver, memberA, characterId);

  /** [fix round 1, Important 2] Storage-level re-read: opens a FRESH reader on `charStreamId` and
   * confirms catch-up delivers exactly `expectedCount` events (the legitimate ones so far) and
   * never `excludedId` (whichever forgery attempt this call follows) — proves the forgery didn't
   * merely get REJECTED at the gateway but also never actually landed on the character stream's own
   * storage, the same standard shape 1's own check already held itself to. */
  async function verifyForgeryDidNotLand(expectedCount: number, excludedId: string, label: string): Promise<void> {
    const reader = await driver.openStream({ streamId: charStreamId, session: memberA });
    const { rid } = await sendHello(reader, charStreamId, 0);
    const frames = await reader.collect((buf) => {
      const gotWelcome = buf.some((f) => isWelcomeFor(f, rid));
      const total = buf
        .filter((f): f is EventsMsg => isEventsFor(f, charStreamId))
        .reduce((s, f) => s + f.events.length, 0);
      return gotWelcome && total >= expectedCount;
    });
    const ids = frames
      .filter((f): f is EventsMsg => isEventsFor(f, charStreamId))
      .flatMap((f) => f.events.map((e) => e.id));
    expect(ids, `${label}: never reached the character stream at all`).not.toContain(excludedId);
    reader.close();
  }

  const charStream = await driver.openStream({ streamId: charStreamId, session: memberA });
  const charCreated = characterCreatedEvent(charStreamId, memberA.userId);
  const charJoined = campaignEvent(
    charStreamId,
    'character.campaign_joined',
    1,
    { campaignId },
    memberA.userId,
    'owner',
  );
  const charOutcome = await appendAndWait(charStream, [charCreated, charJoined]);
  expect(charOutcome.rejected).toEqual([]);
  charStream.close();

  const aCampStream = await driver.openStream({ streamId, session: memberA, role: 'member' });
  const mirrorJoin = campaignEvent(
    streamId,
    'campaign.character_joined',
    1,
    { characterId, ownerId: memberA.userId, name: 'A' },
    memberA.userId,
    'member',
  );
  const mirrorOutcome = await appendAndWait(aCampStream, [mirrorJoin]);
  expect(mirrorOutcome.rejected).toEqual([]);
  aCampStream.close();

  // (1) memberB forges an owner-class action on memberA's character through the gateway.
  const bCampStream = await driver.openStream({ streamId, session: memberB, role: 'member' });
  const forgedNote = noteEvent(charStreamId, memberB.userId, 8);
  const forgedOutcome = await appendAndWait(bCampStream, [forgedNote]);
  expect(forgedOutcome.acked, 'a member forging an owner action on a character they do not own is never acked').toEqual(
    [],
  );
  expect(
    forgedOutcome.rejected[0]?.code,
    "refused forbidden: mapGatewayActor's owner branch requires the payload's real owner to match the acting member",
  ).toBe('forbidden');
  bCampStream.close();

  // created + campaign_joined only — the forgery must not land on the character stream's own storage.
  await verifyForgeryDidNotLand(2, forgedNote.id, 'the forged note');

  // (2) a DIFFERENT campaign's DM attempts to reach memberA's character (never joined to THAT dm's
  // own campaign) via a dm-class gateway forward — "foreign-campaign DM reach attempt".
  const foreignDm = await registerAndLogin(driver, 'CampForgeForeignDm');
  const foreignCampaignId = crypto.randomUUID();
  const foreignStreamId = `camp:${foreignCampaignId}`;
  await createCampaignHttp(driver, foreignDm, foreignCampaignId);

  const foreignDmStream = await driver.openStream({ streamId: foreignStreamId, session: foreignDm, role: 'dm' });
  const dmClassEvent = campaignEvent(
    charStreamId,
    'resource.spent',
    1,
    { resourceId: 'ki-points', count: 1 },
    foreignDm.userId,
    'dm',
  );
  const foreignOutcome = await appendAndWait(foreignDmStream, [dmClassEvent]);
  expect(foreignOutcome.acked, 'a foreign campaign DM cannot reach a character never joined to THEIR campaign').toEqual(
    [],
  );
  expect(foreignOutcome.rejected[0]?.code).toBe('forbidden');
  foreignDmStream.close();

  // still just created + campaign_joined — the foreign-campaign DM's forgery must not land either.
  await verifyForgeryDidNotLand(2, dmClassEvent.id, "the foreign-campaign DM's resource.spent forgery");
}

/** The 12-member cap (doc-08/quotas.ts `CAMPAIGN_MEMBER_MAX`) — the ROUTE's own primary gate
 * (`core/routes/campaigns.ts`'s header comment: "THIS route is the PRIMARY gate"), entirely
 * REST-driven (no WS needed): the DM counts as member #1 (bootstrap `member.joined`); 11 more joins
 * fill the cap at 12; the 13th is rejected. */
async function campaignMemberQuotaScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampQuotaDm');
  const campaignId = crypto.randomUUID();
  const created = await createCampaignHttp(driver, dm, campaignId);

  for (let i = 0; i < 11; i += 1) {
    const member = await registerAndLogin(driver, `CampQuotaM${i}`);
    const joined = await joinCampaignHttp(driver, member, created.joinCode);
    expect(joined.status, `join #${i + 1} of 11 (within the 12-member cap including the DM)`).toBe(200);
  }

  const thirteenth = await registerAndLogin(driver, 'CampQuotaOver');
  const overJoined = await joinCampaignHttp(driver, thirteenth, created.joinCode);
  expect(overJoined.status, 'the 13th member is rejected by the route-level 12-member quota gate').toBe(409);
}

/** [gap (c), Node-only — see this file's header comment] Live presence: a member joins with a
 * custom `displayName`, connects, and the LEADING-EDGE presence broadcast (a fresh `CampaignActor`
 * instance's throttle starts at `-Infinity`, so the FIRST `hello` on it sends immediately — no
 * throttle wait needed) carries that resolved display name back to the SAME connection (fix round
 * 1's `liveDisplayNameFor`). Also proves `bye` on removal (doc-03/Global Constraints): the DM
 * removes this same live member; their still-open socket receives a `bye {reason}` frame. */
async function campaignPresenceAndByeScenario(driver: ConformanceDriver): Promise<void> {
  const dm = await registerAndLogin(driver, 'CampPresenceDm');
  const member = await registerAndLogin(driver, 'CampPresenceMember');
  const campaignId = crypto.randomUUID();
  const streamId = `camp:${campaignId}`;
  const displayName = 'Aria the Bold';
  const created = await createCampaignHttp(driver, dm, campaignId);
  const joined = await joinCampaignHttp(driver, member, created.joinCode, displayName);
  expect(joined.status).toBe(200);

  const memberStream = await driver.openStream({ streamId, session: member, role: 'member' });
  await sendHello(memberStream, streamId, 0);
  const frames = await memberStream.collect((buf) => buf.some((f) => f.t === 'members'), 5000);
  const membersFrame = frames.find((f): f is MembersMsg => f.t === 'members');
  expect(membersFrame, 'a live presence members frame arrives on connect').toBeDefined();
  const own = membersFrame?.members.find((m) => m.userId === member.userId);
  expect(
    own?.displayName,
    'gap (c): the display name set at join time flows end-to-end into the live presence frame',
  ).toBe(displayName);
  expect(own?.online).toBe(true);

  const removeRes = await driver.fetch(`/api/campaigns/${campaignId}/members/${member.userId}`, {
    method: 'DELETE',
    headers: { ...XRW, cookie: dm.cookie },
  });
  expect(removeRes.status, 'DM removes the still-connected member').toBe(204);

  const byeFrames = await memberStream.collect((buf) => buf.some((f) => f.t === 'bye'), 5000);
  const bye = byeFrames.find((f): f is ByeMsg => f.t === 'bye');
  expect(bye?.reason, 'bye on removal: the removed member is told why over their still-open socket').toBeTruthy();
  memberStream.close();
}

export const scenarios: readonly Scenario[] = [
  {
    name: 'auth lifecycle: register -> salt -> login -> wrong-verifier 401 -> reset -> lockout',
    run: authLifecycleScenario,
  },
  { name: 'append / read / head', run: appendReadHeadScenario },
  { name: 'owner-only permissions: a non-owner is refused the WS handoff', run: ownerOnlyScenario },
  { name: 'quota warning (80%) then reject (100%), per stream', run: quotaScenario },
  { name: 'dedupe idempotence: a retry is acked with the existing seq', run: dedupeScenario },
  { name: 'tx atomicity: a txId group commits or rejects as one unit', run: txAtomicityScenario },
  { name: 'hello / catch-up paging: a 450-event stream pages 200/200/50', run: catchUpPagingScenario },
  { name: 'rate limits: the per-IP auth cap (30/min)', run: ipRateLimitScenario },

  // --- campaign scenarios (plan-9 Task 10) --------------------------------------------------
  {
    name: 'campaign lifecycle: create / list / join / rotate-code / remove-member / refused reconnect',
    run: campaignLifecycleScenario,
  },
  {
    name: 'campaign gap (a): a real member-role action succeeds through the real adapter surface',
    run: campaignMemberWriteScenario,
  },
  {
    name: 'campaign read-visibility filtering: roll.logged/chat.message routing + dm.note_* DM-only',
    run: campaignVisibilityScenario,
  },
  {
    name: 'campaign gateway forward + mirror verification: a member-owned character joins and is written through',
    run: campaignGatewayMirrorScenario,
  },
  {
    name: 'campaign gap (d): mirror verification against a fresh/untouched character stream is refused identically',
    run: campaignMirrorFreshStreamScenario,
  },
  {
    name: 'campaign gap (b): owner-forgery and a foreign-campaign DM reach attempt are both refused at the gateway',
    run: campaignForgeryScenario,
  },
  { name: 'campaign quota: the 12-member cap, 13th join refused', run: campaignMemberQuotaScenario },
  {
    name: 'campaign gap (c): live presence carries the resolved display name; bye on removal (Node-only — see header comment)',
    run: campaignPresenceAndByeScenario,
    adapters: ['node'],
  },
];
