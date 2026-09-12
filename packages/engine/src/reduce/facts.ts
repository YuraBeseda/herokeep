import type { SystemEntity } from '@hk/protocol';

export interface SkippedEvent {
  eventId: string;
  reason: string;
}

export interface ClassEntry {
  classId: string;
  level: number;
  subclassId?: string;
}

export interface ConditionEntry {
  conditionId: string;
  source?: string;
  sinceEventId: string;
  level?: number;
}

export interface InventoryEntry {
  instanceId: string;
  itemId?: string;
  qty: number;
  equipped: boolean;
  attuned: boolean;
  name?: string;
  notes?: string;
  custom?: Record<string, unknown>;
}

export interface NoteEntry {
  id: string;
  title: string;
  body: string;
}

export interface Facts {
  streamId: string;
  created: boolean;
  archived: boolean;
  name: string;
  system: string;
  grammaticalGender: 'masculine' | 'feminine' | 'neuter';
  appearance: Record<string, string>;
  portrait?: { hash: string; thumbHash: string };
  createdWith: { engineVersion: string };
  pins: Record<string, string>;
  decisions: Record<string, string[]>;
  decisionContexts: Record<string, Record<string, unknown>>; // decision.made context, for the timeline
  classes: ClassEntry[]; // order = order gained
  xp: number;
  hpRolls: Record<string, (number | 'average')[]>; // classId -> one entry per gained level >= 2, for derive to price
  /**
   * Stored RAW by the reducer: `current` may transiently exceed the derived max, because the
   * reducer has no access to the DERIVE side's computed max HP (that depends on content-pack
   * rules the reducer doesn't load). `derive` clamps `current` to [0, max] for display, and
   * `propose.heal` / `propose.damage` compute already-clamped deltas so a well-formed app never
   * asks the reducer to overshoot in the first place. Determinism therefore holds either way:
   * the reducer only ever adds the deltas it is given.
   *
   * `current` may also be the literal `'max'` — the long-rest `hpToMax` sentinel written by
   * `rest.taken`'s handler (full contract documented in `handlers/casting.ts`'s header comment).
   * It means "full": `derive` resolves it to the computed max, and `propose.damage` /
   * `propose.heal` resolve it to a number before computing their deltas — a well-formed app
   * never hands the reducer a raw `hp.changed` while `current` is still `'max'`. A hand-written
   * `hp.changed` that does arrive in that state skips with reason `'hp-unresolved'` instead of
   * doing arithmetic on the sentinel.
   */
  hp: { current: number | 'max'; temp: number; maxOverride?: number };
  hitDiceSpent: Record<string, number>; // classId → spent
  deathSaves: { successes: number; failures: number };
  slotsUsed: Record<number, number>; // spell level → used
  resourcesUsed: Record<string, number>; // resourceId → used
  conditions: ConditionEntry[];
  concentration?: { spellId: string; sinceEventId: string };
  preparedSpells: Record<string, string[]>; // classId → spellIds
  knownSpells: Record<string, string[]>; // classId → spellbook/known spellIds
  inventory: InventoryEntry[];
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  inspiration: boolean;
  notes: NoteEntry[];
  overrides: { path: string; value: unknown; reason: string }[];
  skipped: SkippedEvent[];
  lastSeq: number;
  appliedEventIds: string[];
}

export function emptyFacts(streamId: string): Facts {
  return {
    streamId,
    created: false,
    archived: false,
    name: '',
    system: '',
    grammaticalGender: 'neuter',
    appearance: {},
    createdWith: { engineVersion: '' },
    pins: {},
    decisions: {},
    decisionContexts: {},
    classes: [],
    xp: 0,
    hpRolls: {},
    hp: { current: 0, temp: 0 },
    hitDiceSpent: {},
    deathSaves: { successes: 0, failures: 0 },
    slotsUsed: {},
    resourcesUsed: {},
    conditions: [],
    preparedSpells: {},
    knownSpells: {},
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    inspiration: false,
    notes: [],
    overrides: [],
    skipped: [],
    lastSeq: 0,
    appliedEventIds: [],
  };
}

/** Rules from the pinned core pack's `system` entity that the reducer needs (rest & HP math). */
export interface SystemRules {
  restRules: SystemEntity['restRules'];
  hpRules: SystemEntity['hpRules'];
}

export interface Snapshot {
  seq: number;
  facts: Facts;
  engineVersion: string;
  rules?: SystemRules;
}

/** Shared guard: every content-mutating handler must have a created character to act on. */
export function requireCreated(f: Facts): string | undefined {
  return f.created ? undefined : 'not-created';
}
