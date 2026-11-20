import type { DerivedValue } from '@shared/directives/derived-popover.directive';
import { signed } from '../../../../ui/format';
import type { ScopedT } from './play-rolls.service';
import type { sheetNames } from './play-names';

/** "Dexterity +2, proficiency +2": a derived value's parts, as the sheet derived them. */
export function breakdownText(
  value: DerivedValue,
  t: ScopedT,
  names: ReturnType<typeof sheetNames>,
): string {
  return value.contributions
    .map((c) => {
      const amount = c.amount === undefined ? (c.formula ?? '') : signed(c.amount);
      if (c.kind === 'proficiency' && c.key !== undefined) {
        return t(`sheet.skills.partRank.${c.key}`, { value: amount });
      }
      const name =
        c.kind === 'abilityModifier' && c.key !== undefined
          ? names.abilityName(c.key)
          : names.resolve(c.feature ?? c.source);
      return t('sheet.skills.part', { name, value: amount });
    })
    .join(', ');
}
