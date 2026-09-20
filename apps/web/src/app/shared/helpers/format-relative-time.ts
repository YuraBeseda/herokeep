/**
 * Relative-time formatting for the settings Devices card (task-9-brief.md: "relative times via
 * the existing date/time formatting conventions"). No prior convention exists in this codebase —
 * the Timeline tab renders event SENTENCES (`event-sentence.pipe.ts`), never wall-clock
 * timestamps — so this follows `settings.component.ts`'s own `formatMb`/`LocaleService` pattern
 * instead: a platform `Intl` formatter (here `Intl.RelativeTimeFormat`) driven off the active
 * locale, never a hand-built string. The unit ladder mirrors common "last seen" UIs (GitHub,
 * Slack, ...): minute/hour/day/week/month/year, each in `numeric: 'auto'` mode so English gets
 * "yesterday"/"last year" where CLDR defines them.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const UNITS: readonly { readonly unit: Intl.RelativeTimeFormatUnit; readonly ms: number }[] = [
  { unit: 'year', ms: YEAR },
  { unit: 'month', ms: MONTH },
  { unit: 'week', ms: WEEK },
  { unit: 'day', ms: DAY },
  { unit: 'hour', ms: HOUR },
  { unit: 'minute', ms: MINUTE },
];

/** `timestampMs` relative to `nowMs` (defaults to `Date.now()` — callers under test always pass
 * an explicit `nowMs` for determinism). Sub-minute gaps collapse to a flat "now" (`rtf.format(0,
 * 'second')`) rather than "37 seconds ago" — second-level precision isn't meaningful for a
 * device's last-seen time, and `numeric: 'auto'` only special-cases whole-unit 0/±1 anyway. */
export function formatRelativeTime(
  timestampMs: number,
  locale: string,
  nowMs = Date.now(),
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = timestampMs - nowMs;
  const absMs = Math.abs(diffMs);

  for (const { unit, ms } of UNITS) {
    if (absMs >= ms) {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return rtf.format(0, 'second');
}
