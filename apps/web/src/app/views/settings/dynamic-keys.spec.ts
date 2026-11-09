import { THEME_IDS } from '@hk/ui-tokens/themes';
import { formatBytes } from '@shared/helpers/format-bytes';
import authEn from '../../../assets/i18n/auth/en.json';
import authRu from '../../../assets/i18n/auth/ru.json';
import authUk from '../../../assets/i18n/auth/uk.json';
import packsEn from '../../../assets/i18n/packs/en.json';
import packsRu from '../../../assets/i18n/packs/ru.json';
import packsUk from '../../../assets/i18n/packs/uk.json';
import settingsEn from '../../../assets/i18n/settings/en.json';
import settingsRu from '../../../assets/i18n/settings/ru.json';
import settingsUk from '../../../assets/i18n/settings/uk.json';

/**
 * Ruling R62: lint cannot see a key built at run time from a prefix and a variant, so each such
 * lookup is enumerated here against the real translation files, in every language. A variant added
 * to the code without its key shows up as a raw key on screen; this fails first.
 */
interface Tree {
  readonly [key: string]: string | Tree;
}

function has(tree: Tree, path: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof node !== 'object') return false;
    node = node[part];
  }
  return typeof node === 'string';
}

/** Every unit `formatBytes` can return, found by feeding it a size from each magnitude. */
const BYTE_UNITS = [
  ...new Set([0, 512, 2048, 5e6, 5e9, 5e12].map((n) => formatBytes(n, 'en').unit)),
];

const SECTIONS = ['account', 'appearance', 'storage', 'packs', 'about'];
const LOCALES = ['en', 'ru', 'uk'];
const SETTINGS: Record<string, Tree> = { en: settingsEn, ru: settingsRu, uk: settingsUk };
const AUTH: Record<string, Tree> = { en: authEn, ru: authRu, uk: authUk };
const AUTH_KEYS = [
  'register.passwordHint',
  'register.strengthOk',
  'register.strengthWeak',
  'register.strengthChecking',
  'register.strengthTip',
  'register.strengthTipWeak',
  'recover.newPasswordHint',
  'validation.checking',
  'validation.ok',
  'validation.invalidUsername',
  'validation.tooShort',
  'validation.tooLong',
  'validation.common',
  'validation.containsUsername',
  'errors.invalidCredentials',
  'errors.lockout',
  'errors.usernameTaken',
  'errors.badRequest',
  'errors.network',
  'errors.generic',
];
const PACKS: Record<string, Tree> = { en: packsEn, ru: packsRu, uk: packsUk };

describe('dynamic translation keys exist in every language', () => {
  it('covers every unit formatBytes can return', () => {
    expect(BYTE_UNITS.sort()).toEqual(['b', 'gb', 'kb', 'mb']);
  });

  describe.each(LOCALES)('%s', (locale) => {
    it.each(BYTE_UNITS)('packs info.unit.%s (the packs list and pack info)', (unit) => {
      expect(has(PACKS[locale], `info.unit.${unit}`)).toBe(true);
    });

    it.each(BYTE_UNITS)('settings quota.unit.%s (account storage and device storage)', (unit) => {
      expect(has(SETTINGS[locale], `quota.unit.${unit}`)).toBe(true);
    });

    it.each(THEME_IDS)('settings theme card %s: name and hint', (theme) => {
      expect(has(SETTINGS[locale], `appearance.theme-${theme}`)).toBe(true);
      expect(has(SETTINGS[locale], `appearance.hint-${theme}`)).toBe(true);
    });

    it.each(['compact', 'comfortable'])('settings density %s', (density) => {
      expect(has(SETTINGS[locale], `appearance.density-${density}`)).toBe(true);
    });

    it.each(SECTIONS)('settings index %s', (section) => {
      expect(has(SETTINGS[locale], `index.${section}`)).toBe(true);
    });

    it.each(AUTH_KEYS)('auth %s (chosen in code, not in the template)', (key) => {
      expect(has(AUTH[locale], key)).toBe(true);
    });

    it.each(['en', 'ru', 'uk'])('settings language option %s', (language) => {
      expect(has(SETTINGS[locale], `language.${language}`)).toBe(true);
    });
  });
});
