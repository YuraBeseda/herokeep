export type Rarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary';

/**
 * One carried item as the satchel and the phone ledger display it. Everything here is already
 * resolved by the caller: the name and the sub-caption are translated text, the icon is a sprite
 * id (`ui:<name>` or `gi:<slug>`). Nothing here is a rule; the caller decides what is equipped,
 * attuned or out of charges.
 */
export interface BagItem {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly qty?: number;
  readonly equipped?: boolean;
  readonly attuned?: boolean;
  readonly rarity?: Rarity | null;
  /** The rarity as a translated word; always printed in the sub-caption. */
  readonly rarityLabel?: string | null;
  /** Weight, charges, uses: translated text for the sub-caption. */
  readonly sub?: string | null;
  /** The sub-caption reads "out of charges" and takes the danger ink. */
  readonly depleted?: boolean;
  /** An unidentified item: its name is shown in italics. */
  readonly unknown?: boolean;
}

/** The translated words a bag item's spoken sentence is built from. */
export interface BagItemWords {
  readonly quantity: (count: number) => string;
  readonly equipped: string;
  readonly attuned: string;
  readonly unknown: string;
}

/** The sub-caption of an item: the rarity word, then the weight / charges text. */
export function bagItemSub(item: BagItem): string {
  return [item.rarityLabel, item.sub].filter(Boolean).join(' · ');
}

/**
 * The full sentence for an item ("Ring of Protection, rare, 0/7, Equipped, Attuned"): its
 * accessible name and its hint, so every visible value is also spoken and no ellipsised caption
 * is lost.
 */
export function bagItemSentence(item: BagItem, words: BagItemWords): string {
  const parts: string[] = [item.name];
  if (item.unknown) parts.push(words.unknown);
  if (item.rarityLabel) parts.push(item.rarityLabel);
  if (item.sub) parts.push(item.sub);
  if (item.qty !== undefined && item.qty > 1) parts.push(words.quantity(item.qty));
  if (item.equipped) parts.push(words.equipped);
  if (item.attuned) parts.push(words.attuned);
  return parts.join(', ');
}

/** A Transloco translate function, as the templates receive it (`*transloco="let t"`). */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * The i18n keys (scope `shell`) of the words of a bag item's sentence. Kept in a table, not
 * written at the call, so the key scanner does not read them as keys of the root scope.
 */
const WORD_KEYS = {
  quantity: 'ui.item.quantity',
  equipped: 'ui.item.equipped',
  attuned: 'ui.item.attuned',
  unknown: 'ui.item.unknown',
} as const;

/** The words of a bag item's sentence, translated with the template's `t`. */
export function bagItemWords(t: Translate): BagItemWords {
  return {
    quantity: (count) => t(WORD_KEYS.quantity, { count }),
    equipped: t(WORD_KEYS.equipped),
    attuned: t(WORD_KEYS.attuned),
    unknown: t(WORD_KEYS.unknown),
  };
}
