import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Event, parseEvent } from '@hk/protocol';
import { createContentIndex } from '../src/content/index.ts';
import { derive } from '../src/derive/index.ts';
import type { SystemRules } from '../src/reduce/facts.ts';
import { reduce } from '../src/reduce/reducer.ts';
import { loadDistPack, loadGoldens } from './support/golden.ts';

/**
 * Perf budget (task-15-brief.md Step 3): fighter-5-play's real event log (creation through level 5
 * plus its ~15-event play sequence) extended with 500 synthetic in-play events (cycled
 * damage/heal/slot events), reduced and derived 5 times; the median wall time must stay under
 * 150ms — generous CI headroom over the ~30ms real-device target (plan 6's checklist measures
 * that on an actual device; this is a regression tripwire, not the device measurement).
 */

function hex(n: number): string {
  return n.toString(16).padStart(12, '0');
}

/**
 * 500 synthetic events continuing the fixture's stream/seq, cycling through all three kinds the
 * brief calls for — damage, heal, and spell-slot spend/restore — so the perf tripwire exercises
 * `reduce`'s slot-handling path under load too, not just `hp.changed`. Net effect is a no-op by
 * design (each foursome's damage/heal and spend/restore cancel out): this measures steady-state
 * per-event reduce/derive cost, not a specific end state.
 */
function syntheticEvents(stream: string, startSeq: number, count: number): Event[] {
  const events: Event[] = [];
  const KIND: { type: string; payload: unknown }[] = [
    { type: 'hp.changed', payload: { delta: -1, kind: 'damage' } },
    { type: 'hp.changed', payload: { delta: 1, kind: 'heal' } },
    { type: 'slot.spent', payload: { level: 1 } },
    { type: 'slot.restored', payload: { level: 1 } },
  ];
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i + 1;
    const { type, payload } = KIND[i % KIND.length]!;
    const e = {
      id: `018f7f00-0000-7000-9000-${hex(i + 1)}`,
      stream,
      seq,
      ts: `2026-09-10T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      actor: { userId: 'u1', deviceId: 'd1', role: 'owner' as const },
      type,
      v: 1,
      payload,
    };
    const parsed = parseEvent(e);
    if (!parsed.ok) throw new Error(`bad synthetic event: ${JSON.stringify(parsed.issues)}`);
    events.push(parsed.event);
  }
  return events;
}

describe('perf budget', () => {
  it('reduces + derives fighter-5-play + 500 synthetic events in under 150ms (median of 5)', () => {
    const fixture = loadGoldens().find((f) => f.name === 'fighter-5-play');
    if (!fixture) throw new Error('fighter-5-play golden fixture not found — run task 15 steps 1-2 first');

    const events = fixture.events.map((e) => {
      const r = parseEvent(e);
      if (!r.ok) throw new Error(`bad fixture event: ${JSON.stringify(r.issues)}`);
      return r.event;
    });
    const lastSeq = Math.max(...events.map((e) => e.seq ?? 0));
    const stream = events[0]!.stream;
    const allEvents = [...events, ...syntheticEvents(stream, lastSeq, 500)];

    // Reuse the harness's own dist-pack loader (version-scanning, clear build-first message) —
    // never hardcode the pack path/version here, so a pack version bump can't silently break
    // this file with a raw ENOENT instead of golden.ts's actionable error.
    const pack = loadDistPack('srd-5e-2024');
    const index = createContentIndex([pack]);
    if (index.diagnostics.length > 0) throw new Error(JSON.stringify(index.diagnostics));
    const rules: SystemRules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const facts = reduce(allEvents, undefined, rules);
      derive(facts, index, rules);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;

    console.info(
      `[perf] fighter-5-play + 500 synthetic events (${allEvents.length} total): samples=${samples.map((s) => s.toFixed(2)).join(', ')}ms median=${median.toFixed(2)}ms`,
    );

    // NOTE: this appends one line per test run — PERF.md is a running log, not a single snapshot;
    // trim old entries by hand if it grows unwieldy (kept simple deliberately: no rotation logic).
    const perfMdPath = new URL('golden/PERF.md', import.meta.url);
    const line = `- ${new Date().toISOString()}: ${allEvents.length} events, samples [${samples.map((s) => s.toFixed(2)).join(', ')}] ms, median ${median.toFixed(2)} ms (budget 150 ms)\n`;
    if (!existsSync(perfMdPath)) {
      writeFileSync(
        perfMdPath,
        '# Engine perf budget\n\n' +
          "Median of 5 `reduce` + `derive` runs over `fighter-5-play`'s real event log (creation " +
          'through level 5, plus its ~15-event play sequence) extended with 500 synthetic in-play ' +
          'events (cycled damage/heal/slot spend+restore). Budget: 150ms (generous CI headroom ' +
          'over the ~30ms real-device target measured separately in plan 6). See `test/perf.test.ts`.\n\n' +
          '## Measurements\n\n' +
          '(Appended one line per test run — this file is a running log; trim old entries by hand ' +
          'if it grows too long. No automatic rotation.)\n\n',
      );
    }
    appendFileSync(perfMdPath, line);

    expect(median).toBeLessThan(150);
  });
});
