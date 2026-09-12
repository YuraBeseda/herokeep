# Engine perf budget

Median of 5 `reduce` + `derive` runs over `fighter-5-play`'s real event log (creation through level 5, plus its ~15-event play sequence) extended with 500 synthetic in-play events (cycled damage/heal/slot spend+restore). Budget: 150ms (generous CI headroom over the ~30ms real-device target measured separately in plan 6). See `test/perf.test.ts`.

## Measurements

(Appended one line per test run — this file is a running log; trim old entries by hand if it grows too long. No automatic rotation.)

- 2026-09-12T20:15:50.041Z: 536 events, samples [1.68, 2.39, 2.53, 6.72, 8.45] ms, median 2.53 ms (budget 150 ms)
- 2026-09-12T20:17:03.137Z: 536 events, samples [4.00, 4.77, 6.81, 9.88, 20.97] ms, median 6.81 ms (budget 150 ms)
