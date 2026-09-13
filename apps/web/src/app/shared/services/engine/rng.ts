/**
 * Uniform random float in `[0, 1)`, drawn from `crypto.getRandomValues` rather than
 * `Math.random`. App-layer RNG: the engine's own dice roller (`packages/engine/src/dice`) takes
 * its RNG as an injected parameter instead (the determinism lint forbids `Math.random` there,
 * docs/02-architecture/05-rules-engine.md) — this is the concrete implementation the web app
 * passes in wherever the engine wants one (e.g. `parseRollSpec`/`roll`'s caller).
 */
export function cryptoRng(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 2 ** 32;
}
