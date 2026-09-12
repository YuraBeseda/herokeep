/**
 * Dice notation (doc-05 § Dice). `RollSpec` is the parsed, structured shape `roll()` (roll.ts)
 * consumes; `parseRollSpec` turns free-text notation like `'4d6kh3'`, `'2d20kl1'`, `'1d8+3'`,
 * `'d20'` or `'d20 adv'` into one.
 */
export interface RollSpec {
  dice: { n: number; sides: number; keep?: { mode: 'highest' | 'lowest'; count: number } }[];
  modifier: number;
  advantage?: 'adv' | 'dis' | 'none';
}

/** `FormulaError`-style (formula/lexer.ts): a distinct error type so callers can catch bad dice text specifically. */
export class DiceFormulaError extends Error {
  readonly code = 'syntax';
  constructor(message: string) {
    super(message);
    this.name = 'DiceFormulaError';
  }
}

/** One dice term (`4d6kh3`, `2d20kl1`, `d20`) or one flat integer modifier term (`3`), each optionally signed. */
const TERM_RE = /([+-]?)(\d*d\d+(?:k[hl]\d+)?|\d+)/gi;
const DICE_RE = /^(\d*)d(\d+)(?:k([hl])(\d+))?$/i;

/**
 * Parses dice notation: one or more `NdSIDES[khX|klX]` dice terms and/or signed flat-integer
 * modifier terms, joined with `+`/`-` (internal whitespace is ignored), plus an optional trailing
 * `' adv'` / `' dis'` advantage marker (must be separated from the rest by whitespace, so it can't
 * be confused with an identifier inside a dice term). Throws `DiceFormulaError` on anything else:
 * empty input, a dice term with zero/negative count or sides, an out-of-range keep count, a negated
 * dice term (`-4d6` — nonsensical: negating a pool of independently-rolled dice), or leftover
 * characters that don't parse as a term.
 */
export function parseRollSpec(text: string): RollSpec {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new DiceFormulaError('Empty roll formula');
  }
  let advantage: 'adv' | 'dis' | undefined;
  let body = text.trim();
  const advMatch = /\s+(adv|dis)$/i.exec(body);
  if (advMatch) {
    advantage = advMatch[1]!.toLowerCase() as 'adv' | 'dis';
    body = body.slice(0, advMatch.index);
  }
  body = body.replace(/\s+/g, '');
  if (body.length === 0) throw new DiceFormulaError('Missing dice or modifier term');

  const dice: RollSpec['dice'] = [];
  let modifier = 0;
  let matches = 0;
  let cursor = 0;
  TERM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TERM_RE.exec(body))) {
    if (m.index !== cursor) {
      throw new DiceFormulaError(`Unexpected characters in "${text}" near "${body.slice(cursor)}"`);
    }
    cursor = TERM_RE.lastIndex;
    matches++;
    const sign = m[1] === '-' ? -1 : 1;
    const term = m[2]!;
    const diceMatch = DICE_RE.exec(term);
    if (diceMatch) {
      if (sign === -1) throw new DiceFormulaError(`Dice terms cannot be negated: "${term}"`);
      const n = diceMatch[1] ? Number(diceMatch[1]) : 1;
      const sides = Number(diceMatch[2]);
      if (n <= 0) throw new DiceFormulaError(`Dice count must be positive: "${term}"`);
      if (sides <= 0) throw new DiceFormulaError(`Dice sides must be positive: "${term}"`);
      let keep: { mode: 'highest' | 'lowest'; count: number } | undefined;
      if (diceMatch[3]) {
        const count = Number(diceMatch[4]);
        if (count <= 0 || count > n) throw new DiceFormulaError(`Invalid keep count in "${term}"`);
        keep = { mode: diceMatch[3].toLowerCase() === 'h' ? 'highest' : 'lowest', count };
      }
      dice.push({ n, sides, ...(keep ? { keep } : {}) });
    } else {
      modifier += sign * Number(term);
    }
  }
  if (cursor !== body.length) {
    throw new DiceFormulaError(`Unexpected characters in "${text}" near "${body.slice(cursor)}"`);
  }
  if (matches === 0) throw new DiceFormulaError(`No dice or modifier terms found in "${text}"`);

  return { dice, modifier, ...(advantage ? { advantage } : {}) };
}
