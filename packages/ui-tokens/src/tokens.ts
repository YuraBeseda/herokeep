import raw from './tokens.json' with { type: 'json' };
import { tokenSchema, type TokenEntry, type TokenFile } from './schema.ts';
import { THEME_IDS, type ThemeId } from './themes.ts';

export { THEME_IDS, type ThemeId };

/** The design-system tokens, validated at module load. */
export const TOKENS: TokenFile = tokenSchema.parse(raw);

/** A token's value for one theme: a plain string applies to every theme. */
export function themeValue(token: TokenEntry, theme: ThemeId): string {
  if (typeof token.value === 'string') return token.value;
  const value = token.value[theme];
  if (value === undefined) throw new Error(`token ${token.name} has no value for theme ${theme}`);
  return value;
}

const REFERENCE = /^\{([a-z0-9-]+)\}$/;

/** Concrete colour of a colour token in a theme, following `{other-token}` references. */
export function resolveColor(name: string, theme: ThemeId): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`colour token reference cycle at ${current}`);
    seen.add(current);
    const token = TOKENS.color.tokens.find((t) => t.name === current);
    if (!token) throw new Error(`unknown colour token ${current}`);
    const value = themeValue(token, theme);
    const ref = REFERENCE.exec(value)?.[1];
    if (ref === undefined) return value;
    current = ref;
  }
}
