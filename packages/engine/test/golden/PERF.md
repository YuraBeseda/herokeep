# Engine perf budget

Median of 5 `reduce` + `derive` runs over `fighter-5-play`'s real event log (creation through level 5, plus its ~15-event play sequence) extended with 500 synthetic in-play events (cycled damage/heal). Budget: 150ms (generous CI headroom over the ~30ms real-device target measured separately in plan 6). See `test/perf.test.ts`.

## Measurements

- 2026-09-12T20:03:49.897Z: 536 events, samples [1.91, 2.02, 2.10, 2.40, 9.03] ms, median 2.10 ms (budget 150 ms)
- 2026-09-12T20:04:03.815Z: 536 events, samples [3.38, 3.74, 4.50, 5.91, 21.98] ms, median 4.50 ms (budget 150 ms)
- 2026-09-12T20:04:27.531Z: 536 events, samples [3.30, 3.66, 3.94, 4.26, 14.44] ms, median 3.94 ms (budget 150 ms)
- 2026-09-12T20:05:32.683Z: 536 events, samples [2.60, 3.65, 3.73, 3.77, 21.30] ms, median 3.73 ms (budget 150 ms)
