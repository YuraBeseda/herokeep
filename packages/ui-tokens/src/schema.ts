import { z } from 'zod';

/** A token value is one string for every theme, or a string per theme id. */
const themedValue = z.union([z.string(), z.record(z.string(), z.string())]);

const tokenEntry = z.object({
  name: z.string().min(1),
  value: themedValue,
  usage: z.string(),
});

const tokenGroup = z.object({ tokens: z.array(tokenEntry) });

const typeStyle = z.object({
  name: z.string().min(1),
  fontSize: z.string(),
  lineHeight: z.string(),
  fontWeight: z.number(),
  fontStyle: z.string().optional(),
  sample: z.string(),
  usage: z.string(),
});

/** Zod schema of `tokens.json`, the single source of the design tokens. */
export const tokenSchema = z.object({
  name: z.string(),
  version: z.number(),
  meta: z.object({ source: z.string(), aliasesForEngineers: z.string() }),
  color: z.object({
    themes: z.array(z.object({ id: z.string(), name: z.string() })),
    tokens: z.array(tokenEntry),
  }),
  type: z.object({
    fonts: z.array(z.unknown()),
    families: z.object({ display: z.string(), body: z.string() }),
    groups: z.array(z.object({ name: z.string(), family: z.enum(['display', 'body']), styles: z.array(typeStyle) })),
  }),
  spacing: tokenGroup,
  radius: tokenGroup,
  shadow: tokenGroup,
  decoration: tokenGroup.extend({ note: z.string() }),
  duration: tokenGroup,
  size: tokenGroup,
  legacy: tokenGroup.extend({ note: z.string() }),
});

export type TokenFile = z.infer<typeof tokenSchema>;
export type TokenEntry = z.infer<typeof tokenEntry>;
export type TypeStyle = z.infer<typeof typeStyle>;
