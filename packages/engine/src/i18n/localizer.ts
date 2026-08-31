import { type Pack, parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { findChoice } from '../content/choices.ts';

export interface LocalizedText {
  text: string;
  locale: string;
  isFallback: boolean;
}

export interface Localizer {
  readonly locale: string;
  text(entityId: string, field: string): LocalizedText;
  name(entityId: string): string;
  choicePrompt(choiceId: string): LocalizedText;
}

export function baseLanguage(locale: string): string {
  return locale.split('-')[0]!.toLowerCase();
}

type Strings = Record<string, Record<string, string>>;

function stripPack(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(i + 1);
}

export function createLocalizer(index: ContentIndex, locale: string): Localizer {
  const base = baseLanguage(locale);
  const packsById = new Map<string, Pack>(index.packs().map((p) => [p.id, p]));
  /** targetPackId → locale → strings, from translation packs (later packs win per field) */
  const translations = new Map<string, Map<string, Strings>>();
  for (const t of index.translationPacks()) {
    if (!t.translates || !t.strings) continue;
    const byLocale = translations.get(t.translates.id) ?? new Map<string, Strings>();
    const existing = byLocale.get(t.locale) ?? {};
    const merged: Strings = { ...existing };
    for (const [key, fields] of Object.entries(t.strings)) merged[key] = { ...(existing[key] ?? {}), ...fields };
    byLocale.set(t.locale, merged);
    translations.set(t.translates.id, byLocale);
  }

  const lookup = (packId: string, key: string, field: string): LocalizedText | undefined => {
    const tries: [string, Strings | undefined][] = [
      [locale, translations.get(packId)?.get(locale)],
      [base, translations.get(packId)?.get(base)],
      [locale, packsById.get(packId)?.i18n[locale]],
      [base, packsById.get(packId)?.i18n[base]],
    ];
    for (const [loc, strings] of tries) {
      const v = strings?.[key]?.[field];
      if (typeof v === 'string' && v.length > 0) return { text: v, locale: loc, isFallback: false };
    }
    return undefined;
  };

  const source = (text: string | undefined): LocalizedText => ({
    text: text ?? '',
    locale: 'en',
    isFallback: locale !== 'en' && base !== 'en',
  });

  const text = (entityId: string, field: string): LocalizedText => {
    const parsed = parseEntityId(entityId);
    const entity = index.get(entityId);
    if (!parsed || !entity) return { text: '', locale: 'en', isFallback: true };
    if (base !== 'en') {
      const hit = lookup(parsed.packId, stripPack(entityId), field);
      if (hit) return hit;
    }
    const rec = entity as unknown as Record<string, unknown>;
    const v = rec[field];
    return source(typeof v === 'string' ? v : undefined);
  };

  const choicePrompt = (choiceId: string): LocalizedText => {
    const result = findChoice(index, choiceId);
    if (!result) return { text: '', locale: 'en', isFallback: true };
    const { owner, choice } = result;
    const parsed = parseEntityId(owner.id);
    if (!parsed) return { text: '', locale: 'en', isFallback: true };
    if (base !== 'en') {
      const hit = lookup(parsed.packId, stripPack(choiceId), 'prompt');
      if (hit) return hit;
    }
    return source(choice.prompt);
  };

  return { locale, text, name: (id) => text(id, 'name').text, choicePrompt };
}
