/** Geometry helpers for the wax seal. Pure and deterministic: the same seed draws the same blob. */

const POINTS = 20;
const WOBBLE = 0.07;
const CENTER = 32;
/** Mean radius of the blob in the 64-unit viewBox (leaves room for the offset shadow). */
const RADIUS = 26.5;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const;

/** Roman figure for a spell-slot level, 1 to 9. */
export function romanNumeral(level: number): string {
  return ROMAN[level] ?? String(level);
}

/** A small seeded generator (mulberry32) so a seal keeps its shape across renders. */
function seeded(seed: number): () => number {
  let state = (seed + 1) * 0x9e3779b1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The outline of a hand-pressed blob: 20 points on a circle, each pushed in or out by up to 7%,
 * joined with a closed Catmull-Rom curve (as cubic Béziers).
 */
export function waxBlobPath(seed: number): string {
  const random = seeded(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < POINTS; i++) {
    const angle = (i / POINTS) * Math.PI * 2;
    const r = RADIUS * (1 + (random() * 2 - 1) * WOBBLE);
    pts.push([CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r]);
  }
  const at = (i: number) => pts[(i + POINTS) % POINTS];
  let d = `M${round(at(0)[0])} ${round(at(0)[1])}`;
  for (let i = 0; i < POINTS; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}
