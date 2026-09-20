/** Byte-count unit codes `formatBytes` can resolve to — never a display string (CLAUDE.md rule
 * 2: no user-visible string literals in TypeScript). A caller renders the actual unit WORD through
 * i18n, keyed off this code (`settings.quota.unit.<code>`, see `settings.component.html`) — this
 * module only ever returns numbers/codes. */
export type ByteUnit = 'b' | 'kb' | 'mb';

export interface FormattedBytes {
  /** The numeric amount, already locale-formatted (`Intl.NumberFormat`) — ready to interpolate
   * into a translated string, never a unit word. */
  readonly amount: string;
  readonly unit: ByteUnit;
}

const KB = 1024;
const MB = 1024 * 1024;

/**
 * Human-readable byte formatting for the settings Quota card (task-9-brief.md): picks b/KB/MB by
 * magnitude and formats the numeric amount for `locale` via `Intl.NumberFormat` — the same
 * platform API `settings.component.ts`'s pre-existing `formatMb` already uses for the Storage
 * card, just with a finer unit ladder. `formatMb` is MB-only, which is fine for a whole-device
 * storage estimate (always multi-MB in practice) but would round every small per-character stream
 * (a fresh character's event log is often well under 1 MB) down to "0.0 MB" — this widens the
 * ladder down to bytes/KB so a Quota row always shows a meaningful figure.
 */
export function formatBytes(bytes: number, locale: string): FormattedBytes {
  const abs = Math.abs(bytes);
  let value: number;
  let unit: ByteUnit;
  if (abs >= MB) {
    value = bytes / MB;
    unit = 'mb';
  } else if (abs >= KB) {
    value = bytes / KB;
    unit = 'kb';
  } else {
    value = bytes;
    unit = 'b';
  }

  const maximumFractionDigits = unit === 'b' ? 0 : 1;
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  return { amount, unit };
}
