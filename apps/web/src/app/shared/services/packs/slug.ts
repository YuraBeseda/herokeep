/**
 * Entity slugs for the device's local `homebrew-<hex>` pack (plan 15 ruling 10): the ASCII slug of the name the
 * user typed — lowercase `[a-z0-9-]`, which `SLUG_RE` accepts — with Cyrillic transliterated.
 *
 * OWNER-FLAG (ruling 10): the transliteration table below is a convenience, not a standard. It is
 * one small Russian table plus the Ukrainian letters; a name containing a Ukrainian-only letter
 * (і ї є ґ) or an apostrophe switches «г»/«и» to their Ukrainian readings (h / y). Anything that is
 * neither ASCII, Latin-with-diacritics nor Cyrillic is dropped; an empty result is handled by
 * `uniqueSlug`'s `<type>-<n>` fallback.
 */

/** Longest slug produced; ids stay readable and well inside every storage key limit. */
export const MAX_SLUG_LENGTH = 64;

const RU: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Ukrainian-only letters (also used when the name is otherwise Russian-looking).
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
};

/** Where the Ukrainian reading differs from the Russian one. */
const UK_OVERRIDES: Readonly<Record<string, string>> = { г: 'h', и: 'y' };

/** Letters (and the apostrophe) that mark a name as Ukrainian. */
const UK_MARKERS = /[іїєґʼ’]/u;

const APOSTROPHES = /['’ʼ`]/gu;
const COMBINING_MARKS = /\p{M}+/gu;

function transliterate(lower: string): string {
  const uk = UK_MARKERS.test(lower);
  let out = '';
  for (const ch of lower) {
    out += (uk ? UK_OVERRIDES[ch] : undefined) ?? RU[ch] ?? ch;
  }
  return out;
}

/** The ASCII slug of `name`, or `''` when nothing slug-worthy remains. */
export function slugify(name: string): string {
  // Transliterate BEFORE Unicode decomposition: NFKD would split «й»/«ё»/«ї» into a base letter
  // plus a combining mark and lose the distinction the table makes.
  const ascii = transliterate(name.toLowerCase())
    .replace(APOSTROPHES, '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '');
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}

/**
 * `base` when it is free in `taken`; otherwise `base-2`, `base-3`, …; an empty `base` becomes
 * `<type>-1`, `<type>-2`, … (the first one free).
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>, type: string): string {
  if (base === '') {
    for (let n = 1; ; n++) {
      const candidate = `${type}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
