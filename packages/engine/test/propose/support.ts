import type { Event } from '@hk/protocol';
import type { Sheet } from '../../src/derive/sheet.ts';
import { ProposeError, type ProposedEvent } from '../../src/propose/index.ts';

/** Runs `fn`, expecting it to throw a `ProposeError`, and returns it (so tests can assert on `.diagnostics`). */
export function captureProposeError(fn: () => unknown): ProposeError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProposeError) return e;
    throw e;
  }
  throw new Error('expected a ProposeError to be thrown');
}

/**
 * A minimal but fully-shaped `Sheet` fixture: propose.* functions only ever read a `Sheet` (never
 * a `ContentIndex`), so tests build one directly rather than running the full derive pipeline —
 * each test spreads `baseSheet()` and overrides just the fields its scenario cares about.
 */
export function baseSheet(overrides: Partial<Sheet> = {}): Sheet {
  const sheet: Sheet = {
    name: 'Test',
    system: 'mini',
    level: 1,
    classes: [{ classId: 'core-mini:class/fighter', level: 1 }],
    pins: {},
    abilities: {
      con: {
        score: { value: 14, contributions: [] },
        mod: 2,
        save: { value: 2, contributions: [] },
        saveProficient: false,
      },
    },
    prof: 2,
    skills: {},
    passivePerception: 10,
    speed: { walk: { value: 30, contributions: [] } },
    senses: [],
    languages: [],
    ac: { value: 10, contributions: [] },
    hp: {
      max: { value: 20, contributions: [] },
      current: 20,
      currentWasMax: false,
      temp: 0,
      hitDice: { 'core-mini:class/fighter': { die: 10, total: 1, spent: 0, remaining: 1 } },
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      issues: [],
    },
    initiative: { value: 0, contributions: [] },
    attacks: [],
    attacksPerAction: 1,
    spellcasting: [],
    resources: [],
    actions: [],
    proficiencies: [],
    inventory: [],
    attunementMax: 3,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    inspiration: false,
    conditions: [],
    xp: 0,
    grammaticalGender: 'neuter',
    outstandingChoices: [],
    issues: [],
  };
  return { ...sheet, ...overrides };
}

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const idFor = (n: number) => `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`;

/** Wraps a `ProposedEvent` in the envelope shape `reduce()` expects, matching every other test file's local `ev()` helper. */
export function wrap(n: number, proposed: ProposedEvent, extra: Partial<Event> = {}): Event {
  return {
    id: idFor(n),
    stream,
    seq: n,
    ts: '2026-08-30T12:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'owner' },
    type: proposed.type,
    v: proposed.v,
    payload: proposed.payload,
    ...extra,
  };
}

/** Wraps a whole `propose.*` result (possibly several events, e.g. a rest transaction) into a contiguous seq run starting at `from`. */
export function wrapAll(from: number, proposed: ProposedEvent[]): Event[] {
  return proposed.map((p, i) => wrap(from + i, p));
}

export function ev(n: number, type: string, payload: unknown, extra: Partial<Event> = {}): Event {
  return {
    id: idFor(n),
    stream,
    seq: n,
    ts: '2026-08-30T12:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'owner' },
    type,
    v: 1,
    payload,
    ...extra,
  };
}

export const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});
