import type { HeroSummary } from './hero-summary.service';

type ScopedT = (key: string, params?: Record<string, unknown>) => string;

/**
 * "Fighter 3 · Rogue 1" for a hero card or the Continue leaf: each class through the localizer
 * and the `characters` scope's `sheet.header.classLevel` pattern. Falls back to the system id while
 * the classes are unknown (a hero never opened on this device since it synced, or a log that has
 * not been read yet).
 */
export function heroClassLine(
  summary: HeroSummary | undefined,
  system: string,
  localizer: { name(id: string): string },
  t: ScopedT,
): string {
  const classes = summary?.classes ?? [];
  if (classes.length === 0) return system;
  return classes
    .map((c) => t('sheet.header.classLevel', { class: localizer.name(c.classId), level: c.level }))
    .join(' · ');
}
