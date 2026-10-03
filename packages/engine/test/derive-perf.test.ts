import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEvent } from '@hk/protocol';
import { createContentIndex } from '../src/content/index.ts';
import { derive } from '../src/derive/index.ts';
import type { SystemRules } from '../src/reduce/facts.ts';
import { reduce } from '../src/reduce/reducer.ts';
import { loadDistPack, loadGoldens } from './support/golden.ts';

/**
 * Task 13 (phase 4 plan 11), ruling 10: measure `derive()` ALONE (not `reduce`+`derive` — that's
 * `perf.test.ts`'s own separate 150ms CI tripwire over a synthetic 536-event log, untouched here)
 * on the heaviest golden fixture — `multi-fighter1-wizard19`, a 20-total-level two-class character
 * (Fighter 1 / Wizard 19: full fighter feature set + 19 levels of wizard spellcasting, the most
 * active-effect-dense golden this task ships) — against doc-05's own per-character derive budget
 * (`docs/02-architecture/05-rules-engine.md:113-120`): "`derive` of a level-20 character with ~150
 * active effects: < 5 ms (desktop) / < 15 ms (mid phone)". That figure is a real-device target, not
 * a CI-safe one (the sibling `perf.test.ts` budget is deliberately 5x its own ~30ms device target
 * for exactly this reason) — so this test's own `expect` ceiling is generous CI headroom over the
 * doc-05 number, while the actually-measured median (logged unconditionally, recorded to
 * `golden/PERF.md` only when `HK_RECORD_PERF=1`) is what the task-13 report compares to the 15ms
 * figure directly for its WORKER-NEEDED-or-not verdict. No worker is built by this task either way
 * (ruling 10 is explicit: measure and flag, don't build).
 */
/**
 * Plan 12 task 15: re-measured over the slice-2 goldens too — the three densest level-20 casters
 * (sorcerer: subclass HP + 4 resources; druid; paladin: 5 resources + half-caster) and the two
 * slot-lane multiclass cases — alongside the original plan-11 heaviest golden (same baseline row).
 */
const PERF_FIXTURES = [
  'multi-fighter1-wizard19',
  'sorcerer-20',
  'druid-20',
  'paladin-20',
  'multi-paladin5-cleric3',
  'multi-sorcerer5-warlock3',
];

describe.each(PERF_FIXTURES)('derive-only perf (%s)', (fixtureName) => {
  it('derives well within CI headroom of the 15ms doc-05 budget', () => {
    const fixture = loadGoldens().find((f) => f.name === fixtureName);
    if (!fixture) throw new Error(`${fixtureName} golden fixture not found`);

    const events = fixture.events.map((e) => {
      const r = parseEvent(e);
      if (!r.ok) throw new Error(`bad fixture event: ${JSON.stringify(r.issues)}`);
      return r.event;
    });

    const pack = loadDistPack('srd-5e-2024');
    const index = createContentIndex([pack]);
    if (index.diagnostics.length > 0) throw new Error(JSON.stringify(index.diagnostics));
    const rules: SystemRules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

    // `reduce` runs ONCE, outside the timing loop — only `derive` itself is priced, matching
    // doc-05's own "`derive` of a level-20 character" framing (not a combined reduce+derive cost).
    const facts = reduce(events, undefined, rules);

    const samples: number[] = [];
    for (let run = 0; run < 25; run++) {
      const start = performance.now();
      derive(facts, index, rules);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;

    console.info(
      `[derive-perf] ${fixtureName} (${events.length} events): ` +
        `samples(ms)=${samples.map((s) => s.toFixed(3)).join(', ')} median=${median.toFixed(3)}ms ` +
        `(doc-05 budget: <5ms desktop / <15ms mid phone)`,
    );

    if (process.env['HK_RECORD_PERF'] === '1') {
      const perfMdPath = new URL('golden/PERF.md', import.meta.url);
      const line =
        `- ${new Date().toISOString()}: derive-only, ${fixtureName} (${events.length} events), ` +
        `25 samples, median ${median.toFixed(3)} ms ` +
        `(doc-05 budget: <5ms desktop / <15ms mid phone; plan-12 task-15 measurement, not the ` +
        `reduce+derive 536-event tripwire above)\n`;
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
    }

    // Generous CI headroom (same spirit as perf.test.ts's own 150ms-over-30ms multiplier) over the
    // doc-05 mid-phone figure — a regression tripwire for a shared/loaded CI box, not the device
    // measurement itself (see this file's header comment for the real verdict).
    expect(median).toBeLessThan(75);
  });
});
