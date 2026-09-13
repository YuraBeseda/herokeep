# Engine perf budget

Median of 5 `reduce` + `derive` runs over `fighter-5-play`'s real event log (creation through level 5, plus its ~15-event play sequence) extended with 500 synthetic in-play events (cycled damage/heal/slot spend+restore). Budget: 150ms (generous CI headroom over the ~30ms real-device target measured separately in plan 6). See `test/perf.test.ts`.

## Measurements

(Appended one line per test run — this file is a running log; trim old entries by hand if it grows too long. No automatic rotation.)

- 2026-09-12T20:15:50.041Z: 536 events, samples [1.68, 2.39, 2.53, 6.72, 8.45] ms, median 2.53 ms (budget 150 ms)
- 2026-09-12T20:17:03.137Z: 536 events, samples [4.00, 4.77, 6.81, 9.88, 20.97] ms, median 6.81 ms (budget 150 ms)
- 2026-09-13T02:46:52.203Z: 536 events, samples [2.43, 3.27, 3.33, 3.41, 18.92] ms, median 3.33 ms (budget 150 ms)
- 2026-09-13T02:55:43.602Z: 536 events, samples [3.73, 3.89, 8.34, 8.49, 12.34] ms, median 8.34 ms (budget 150 ms)
- 2026-09-13T02:57:02.728Z: 536 events, samples [3.28, 3.34, 4.66, 7.55, 19.27] ms, median 4.66 ms (budget 150 ms)
- 2026-09-13T02:57:12.116Z: 536 events, samples [4.28, 4.64, 5.44, 5.84, 17.52] ms, median 5.44 ms (budget 150 ms)
- 2026-09-13T02:59:06.256Z: 536 events, samples [2.92, 3.21, 3.30, 3.69, 14.41] ms, median 3.30 ms (budget 150 ms)
- 2026-09-13T03:20:54.165Z: 536 events, samples [3.01, 3.38, 3.91, 3.91, 12.18] ms, median 3.91 ms (budget 150 ms)
- 2026-09-13T03:23:00.487Z: 536 events, samples [2.83, 2.93, 3.83, 6.93, 12.39] ms, median 3.83 ms (budget 150 ms)
