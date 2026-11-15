import { THEME_IDS } from '@hk/ui-tokens/themes';
import { formatBytes } from '@shared/helpers/format-bytes';
import { EVENT_PAYLOADS } from '@hk/protocol';
import campaignsEn from '../../../assets/i18n/campaigns/en.json';
import campaignsRu from '../../../assets/i18n/campaigns/ru.json';
import campaignsUk from '../../../assets/i18n/campaigns/uk.json';
import charactersEn from '../../../assets/i18n/characters/en.json';
import charactersRu from '../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../assets/i18n/characters/uk.json';
import libraryEn from '../../../assets/i18n/library/en.json';
import libraryRu from '../../../assets/i18n/library/ru.json';
import libraryUk from '../../../assets/i18n/library/uk.json';
import shellEn from '../../../assets/i18n/shell/en.json';
import shellRu from '../../../assets/i18n/shell/ru.json';
import shellUk from '../../../assets/i18n/shell/uk.json';
import { TIMELINE_FAMILIES } from '../characters/sheet/timeline/event-sentence.pipe';
import { HOMEBREW_DIAGNOSTIC_CODES } from '../packs/homebrew/homebrew-editor.component';
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

  describe.each(LOCALES)('every other run-time key family, %s', (locale) => {
    const scopes: Record<string, Record<string, Tree>> = {
      auth: AUTH,
      campaigns: { en: campaignsEn, ru: campaignsRu, uk: campaignsUk },
      characters: { en: charactersEn, ru: charactersRu, uk: charactersUk },
      library: { en: libraryEn, ru: libraryRu, uk: libraryUk },
      packs: PACKS,
      settings: SETTINGS,
      shell: { en: shellEn, ru: shellRu, uk: shellUk },
    };
    const ENTITY_TYPES = [
      'system', 'species', 'background', 'class', 'subclass', 'feature', 'feat', 'spell', 'item',
      'condition', 'skill', 'ability', 'language', 'tool', 'rule', 'table',
    ]; // prettier-ignore
    const HOMEBREW_TYPES = ['item', 'spell', 'feat', 'species'];
    const MARKDOWN_SAMPLES = ['bold', 'italic', 'list', 'heading'];
    const SYNC = ['synced', 'pending', 'connecting', 'offline'];
    // The campaign stream's events are never rendered by the character timeline pipe.
    const CAMPAIGN_EVENT =
      /^(campaign-(created|renamed|settings|join|archived|character)|pack-(enabled|disabled)|member-|party-|session-|roll-logged|chat-|dm-note)/;
    const EVENT_KEYS = Object.keys(EVENT_PAYLOADS)
      .map((k) => k.slice(0, k.lastIndexOf('@')).replace(/[._]/g, '-'))
      .filter((k) => !CAMPAIGN_EVENT.test(k));
    /** Each site: [scope, prefix, variants, where the code builds it]. */
    const sites: [string, string, readonly string[], string][] = [
      ['packs', 'entity-type.', ENTITY_TYPES, 'pack-info and packs-list rows'],
      ['library', 'detail.kind.', ENTITY_TYPES, 'library detail trail and tag'],
      ['library', 'type.', ['background', 'class', 'condition', 'feat', 'feature', 'item', 'language', 'rule', 'skill', 'species', 'spell', 'subclass'], 'library browse type filter'],
      ['library', 'class.prof.armor.', ['light', 'medium', 'heavy', 'shields'], 'class-entry armor proficiency'],
      ['library', 'class.prof.weapon.', ['simple', 'martial'], 'class-entry weapon proficiency'],
      ['packs', 'detail.integrity-', ['installed', 'installing', 'error'], 'pack-detail campaign share state'],
      ['settings', 'storage.breakdown.', ['images', 'packs', 'other'], 'settings device storage'],
      ['shell', 'language.', ['en', 'ru', 'uk'], 'app drawer language list'],
      ['shell', 'theme.', THEME_IDS, 'theme menu'],
      ['characters', 'list.sync.tooltip.', SYNC, 'hero card sync tooltip'],
      ['campaigns', 'list.sync.tooltip.', SYNC, 'campaigns list sync tooltip'],
      ['characters', 'sheet.roll.manual.labels.', ['check', 'save', 'attack', 'damage', 'other'], 'roll log manual kinds'],
      ['characters', 'sheet.roll.entries.', ['check', 'save', 'skill', 'attackToHit', 'attackDamage', 'spellAttack'], 'play-rolls log entry'],
      ['characters', 'sheet.roll.announce.', ['check', 'save', 'skill', 'attackToHit', 'attackDamage', 'spellAttack', 'manual'], 'play-rolls announcement'],
      ['characters', 'sheet.inventory.carry.state.', ['normal', 'encumbered', 'heavilyEncumbered', 'overloaded'], 'bag leaf carry state'],
      ['characters', 'timeline.family.', TIMELINE_FAMILIES, 'timeline filter and row family'],
      ['characters', 'timeline.', [...EVENT_KEYS, 'unknown'], 'event-sentence pipe, one per protocol event type'],
      ['characters', 'validation.', ['generic', 'slot.none-left', 'attune.max', 'resource.none-left', 'spell.always-prepared', 'spell.free-cast-unavailable', 'rest.regain-roll-missing', 'rest.regain-roll-invalid', 'selection.count', 'selection.unresolved', 'selection.notOffered', 'selection.duplicate', 'selection.prerequisiteFailed', 'selection.subclassLevel', 'selection.unknownChoice', 'selection.invalidEntry', 'selection.abilityNotAllowed', 'selection.duplicateAbility', 'selection.abilityImproveShape', 'selection.abilityMax', 'selection.standardArrayMismatch', 'selection.pointBuyRange', 'selection.pointBuyBudget', 'selection.manualRange', 'selection.rollRange', 'selection.abilityGenerationInvalid'], 'diagnosticKey in the wizard steps and diagnostic-toast'],
      ['packs', 'homebrew.validation.', [...HOMEBREW_DIAGNOSTIC_CODES, 'generic'], 'homebrew editor diagnostics'],
      ['packs', 'homebrew.enum.category.', ['weapon', 'armor', 'shield', 'gear', 'tool', 'consumable', 'magic'], 'homebrew item category'],
      ['packs', 'homebrew.enum.rarity.', ['common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact'], 'homebrew item rarity'],
      ['packs', 'homebrew.enum.range-kind.', ['self', 'touch', 'feet', 'miles', 'sight', 'unlimited', 'special'], 'homebrew spell range'],
      ['packs', 'homebrew.enum.feat-category.', ['origin', 'general', 'fightingStyle', 'epicBoon'], 'homebrew feat category'],
      ['packs', 'homebrew.enum.weapon-kind.', ['melee', 'ranged'], 'homebrew weapon kind'],
      ['packs', 'homebrew.enum.weapon-category.', ['simple', 'martial'], 'homebrew weapon category'],
      ['packs', 'homebrew.enum.armor-category.', ['light', 'medium', 'heavy'], 'homebrew armor category'],
      ['packs', 'homebrew.enum.time-unit.', ['action', 'bonus', 'reaction', 'minute', 'hour'], 'homebrew casting time'],
      ['packs', 'homebrew.enum.duration-kind.', ['instantaneous', 'time', 'untilDispelled', 'special'], 'homebrew duration kind'],
      ['packs', 'homebrew.enum.duration-unit.', ['round', 'minute', 'hour', 'day'], 'homebrew duration unit'],
      ['packs', 'homebrew.enum.charge-reset.', ['never', 'dawn', 'shortRest', 'longRest'], 'homebrew charges reset'],
      ['packs', 'homebrew.sub.casting.', ['action', 'bonus', 'reaction', 'minute', 'hour'], 'homebrew summary casting time'],
      ['campaigns', 'settings.houseRules.xpMode.', ['label', 'xp', 'milestone'], 'campaign-segmented prefix plus id'],
      ['campaigns', 'settings.houseRules.editOutsideSession.', ['label', 'free', 'dmApproval', 'locked'], 'campaign-segmented prefix plus id'],
      ['campaigns', 'settings.houseRules.hpOnLevelUp.', ['label', 'roll', 'average', 'choice'], 'campaign-segmented prefix plus id'],
      ['campaigns', 'settings.houseRules.encumbrance.', ['label', 'off', 'standard', 'variant'], 'campaign-segmented prefix plus id'],
      ['campaigns', 'settings.visibility.partySheets.', ['label', 'none', 'overview', 'full'], 'campaign-segmented prefix plus id'],
      ['campaigns', 'settings.visibility.rolls.', ['label', 'everyone', 'dm'], 'campaign-segmented prefix plus id'],
      // Added in fix round 1: every remaining prefix-plus-variant lookup found by an rg sweep.
      ['campaigns', 'roles.', ['dm', 'player'], 'campaign shell, lobby and list role badge'],
      ['shell', 'home.campaigns.role.', ['dm', 'player'], 'home campaign chip'],
      ['campaigns', 'shell.tabs.', ['party', 'log', 'lobby', 'settings', 'landmark'], 'campaign shell tabs and list tab links'],
      ['characters', 'sheet.tabs.', ['play', 'build', 'timeline'], 'sheet shell tabs'],
      ['campaigns', 'lobby.members.', ['online', 'offline'], 'lobby member presence'],
      ['campaigns', 'link.progress.step.', ['character', 'campaign'], 'link and leave dialogs'],
      ['campaigns', 'link.progress.outcome.', ['committed', 'rejected', 'timeout', 'skipped'], 'link, leave and handover dialogs'],
      ['campaigns', 'unlink.progress.step.', ['character', 'campaign'], 'unlink dialog'],
      ['campaigns', 'handover.progress.step.', ['characterLeave', 'rosterClear', 'characterRejoin', 'rosterRejoin', 'ownerTransfer'], 'handover dialog'],
      ['campaigns', 'log.visibilityHint.', ['everyone', 'dm', 'private'], 'log entry and composer hint'],
      ['campaigns', 'log.composer.visibility.', ['everyone', 'dm', 'private'], 'log entry badge and composer options'],
      ['campaigns', 'log.composer.sendReason.', ['empty', 'tooLong'], 'log composer send reason'],
      ['campaigns', 'dmEffects.tabs.', ['damage', 'heal', 'temp', 'condition', 'xp', 'level', 'item', 'inspiration', 'override'], 'quick effects and party tab'],
      ['campaigns', 'settings.packs.status.', ['installed', 'installing'], 'campaign packs section'],
      ['campaigns', 'edit.', ['locked', 'dmApprovalV1'], 'campaign edit-lock banner'],
      ['characters', 'wizard.abilityScores.method.', ['standardArray', 'pointBuy', 'manual', 'roll'], 'ability scores step'],
      ['characters', 'wizard.equipment.currency.', ['cp', 'sp', 'ep', 'gp', 'pp'], 'equipment step'],
      ['characters', 'levelUp.review.change.', ['hitDice', 'currentHp', 'spellSlots', 'pactSlots', 'proficiency'], 'level-up review'],
      ['characters', 'sheet.build.proficiencies.', ['armor', 'weapons', 'tools', 'saves', 'skills', 'languages'], 'build proficiencies section'],
      ['characters', 'sheet.build.origin.', ['speciesDetail', 'classDetail', 'subclassDetail', 'backgroundDetail', 'originFeatDetail'], 'build origin section'],
      ['characters', 'sheet.roll.visibility.', ['everyone', 'dm', 'private'], 'roll log drawer'],
      ['characters', 'sheet.resources.reset.', ['shortRest', 'longRest', 'dawn'], 'resources leaf'],
      ['characters', 'timeline.revertConfirm.preview.', ['hp', 'hpMax', 'ac', 'level', 'none'], 'revert dialog'],
      ['shell', 'ui.coins.', ['cp', 'sp', 'ep', 'gp', 'pp'], 'coin pouch stack label'],
      ['shell', 'ui.coins.name-', ['cp', 'sp', 'ep', 'gp', 'pp'], 'coin pouch metal name'],
      ['shell', 'ui.coins.unit-', ['cp', 'sp', 'ep', 'gp', 'pp'], 'coin pouch unit'],
      ['shell', 'ui.weight.state-', ['loaded', 'light', 'encumbered', 'heavy', 'over'], 'weight strap'],
      ['packs', 'homebrew.new.', HOMEBREW_TYPES, 'homebrew chooser, list and editor'],
      ['packs', 'homebrew.edit-title.', HOMEBREW_TYPES, 'homebrew editor title'],
      ['packs', 'homebrew.empty-hint.', HOMEBREW_TYPES, 'homebrew list empty hint'],
      ['packs', 'homebrew.can.', HOMEBREW_TYPES, 'homebrew list capabilities'],
      ['packs', 'homebrew.markdown.', MARKDOWN_SAMPLES, 'markdown help row'],
      ['packs', 'homebrew.markdown.sample.', MARKDOWN_SAMPLES, 'markdown help sample'],
      ['library', 'sort.', ['match', 'name', 'type', 'level'], 'library browse sort'],
    ]; // prettier-ignore

    it.each(sites)('%s %s* (%s)', (scope, prefix, variants) => {
      const missing = variants.filter((v) => !has(scopes[scope][locale], `${prefix}${v}`));
      expect(missing).toEqual([]);
    });

    it.each([
      ['auth', ['title', 'accounts', 'recovery', 'devices', 'close']],
      ['settings', ['title', 'appearance', 'storage', 'account', 'close']],
    ] as const)(
      'help dialog %s: title, topics and close (openHelpDialog builds scope.help.key)',
      (scope, keys) => {
        const tree = scope === 'auth' ? AUTH[locale] : SETTINGS[locale];
        expect(keys.filter((k) => !has(tree, `help.${k}`))).toEqual([]);
      },
    );
  });
});
