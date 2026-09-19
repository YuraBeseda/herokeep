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
 */
import { expect } from 'vitest';
import type {
  AckMsg,
  ClientMessage,
  Event,
  EventsMsg,
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

export interface ConformanceDriver {
  /** Black-box HTTP against the running adapter instance — Node: real `fetch` to an ephemeral-port
   * server; Cloudflare: `SELF.fetch` against the pool-workers-hosted Worker. `path` is an
   * absolute-from-root path (`/api/...`); `init` is passed through verbatim. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Opens a `StreamDriver` for `streamId`, acting as `session` — a scenario must only ever open a
   * stream `session` actually owns (see `Session`'s doc comment on the Cloudflare runner's
   * documented limitation: it does not re-verify ownership at this call the way a real WS upgrade
   * would, because it cannot perform a real upgrade at all under pool-workers). */
  openStream(args: { readonly streamId: string; readonly session: Session }): Promise<StreamDriver>;
}

export interface Scenario {
  readonly name: string;
  readonly run: (driver: ConformanceDriver) => Promise<void>;
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

async function registerAndLogin(driver: ConformanceDriver, seed: string): Promise<AuthedSession> {
  const username = uniqueUsername(seed);
  const verifier = verifierHex(seed);

  const registerRes = await driver.fetch('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt: saltHex(seed) }),
  });
  expect(registerRes.status, `register(${seed})`).toBe(201);
  const registerBody = (await registerRes.json()) as { userId: string; recoveryCodes: string[] };

  const loginRes = await driver.fetch('/api/auth/login', {
    method: 'POST',
    headers: XRW,
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
];
