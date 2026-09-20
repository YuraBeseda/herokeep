// @vitest-environment node
//
// task-3-brief's TDD note flags a genuine tension: unit specs for `password-check.ts` must
// use a SMALL inline fixture behind a stubbed `fetch` (never the real ~10k-line file, which
// would make those specs slow/coupled to list contents), but something should still verify
// the real bundled asset exists and has the shape `password-check.ts` expects to parse
// (newline-separated, non-empty, lowercase, deduplicated). jsdom specs can't easily reach
// the filesystem, so this is a SEPARATE spec file forced into Vitest's Node environment via
// the `@vitest-environment node` docblock (verified empirically to work under this project's
// `@angular/build:unit-test` Vitest runner — `apps/web/tools/check-bundle-budget.spec.ts`
// already establishes the "small node-side spec under tools/" pattern this follows) — it
// reads the file directly with `node:fs`, no jsdom `fetch` involved. An e2e-level assertion
// (T11) additionally proves the register screen can actually FETCH `/assets/auth/
// top-10k-passwords.txt` from the built/served app, which this spec cannot: it only proves
// the source file on disk has the right shape, not that it is served correctly.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_PATH = join(HERE, '..', 'src', 'assets', 'auth', 'top-10k-passwords.txt');

function readLines(): string[] {
  const text = readFileSync(ASSET_PATH, 'utf-8');
  return text.split('\n').filter((line) => line.length > 0);
}

describe('top-10k-passwords.txt (bundled asset)', () => {
  it('exists and is non-empty', () => {
    expect(() => readFileSync(ASSET_PATH, 'utf-8')).not.toThrow();
    expect(readLines().length).toBeGreaterThan(0);
  });

  it('has no blank lines and no leading/trailing whitespace on any line', () => {
    const text = readFileSync(ASSET_PATH, 'utf-8');
    const rawLines = text.split('\n');
    // The file ends with a trailing newline (one blank "line" after the final split) — that's
    // the only blank entry allowed.
    const nonFinalBlanks = rawLines.slice(0, -1).filter((line) => line.length === 0);
    expect(nonFinalBlanks).toEqual([]);
    for (const line of readLines()) {
      expect(line).toBe(line.trim());
    }
  });

  it("is entirely lowercase (matches password-check.ts's case-folded membership check)", () => {
    for (const line of readLines()) {
      expect(line).toBe(line.toLowerCase());
    }
  });

  it('has no duplicate entries', () => {
    const lines = readLines();
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('has at most 10,000 entries (top-10k, never padded beyond the source ranking window)', () => {
    expect(readLines().length).toBeLessThanOrEqual(10_000);
  });

  it('contains well-known common passwords (sanity check the list is the real thing, not a stub)', () => {
    const lines = new Set(readLines());
    expect(lines.has('password')).toBe(true);
    expect(lines.has('123456')).toBe(true);
  });
});
