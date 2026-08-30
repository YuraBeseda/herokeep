import { z } from 'zod';
import { EntityIdSchema, PackIdSchema, SlugSchema, parseEntityId } from '../ids.ts';
import { BlobHashSchema, SemverSchema } from './common.ts';
import { EntitySchema } from './entity.ts';
import { LongTextSchema, ShortTextSchema } from './enums.ts';

export const PACK_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxEntities: 5000,
  maxDescriptionBytes: 20 * 1024,
  maxDependencyDepth: 4,
  maxAssets: 2000,
} as const;

export const PackKindSchema = z.enum(['core', 'content', 'translation', 'theme']);
export const DependencySchema = z.strictObject({ id: PackIdSchema, range: z.string().min(1).max(64) });
export type Dependency = z.infer<typeof DependencySchema>;

export const JsonPointerSchema = z.string().regex(/^(\/([^/~]|~0|~1)*)*$/, 'Expected an RFC 6901 JSON Pointer');
export const OverrideOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  z.strictObject({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  z.strictObject({ op: z.literal('remove'), path: JsonPointerSchema }),
]);
export type OverrideOp = z.infer<typeof OverrideOpSchema>;
export const OverrideSchema = z.strictObject({
  target: EntityIdSchema,
  patch: z.array(OverrideOpSchema).min(1).max(100),
});
export type Override = z.infer<typeof OverrideSchema>;

export const AssetSchema = z.strictObject({
  hash: BlobHashSchema,
  kind: z.enum(['icon', 'portrait', 'banner', 'token']),
  mime: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  size: z
    .int()
    .min(1)
    .max(400 * 1024),
});
export type Asset = z.infer<typeof AssetSchema>;

export const LocaleSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
/** field path → text, e.g. { "name": "…", "description": "…", "prompt": "…" } */
export const TranslationFieldsSchema = z.record(
  z.string().min(1).max(200),
  z.string().max(PACK_LIMITS.maxDescriptionBytes),
);
/** "<type>/<slug>" or a choice id without the pack prefix → fields */
export const TranslationStringsSchema = z.record(z.string().min(1).max(200), TranslationFieldsSchema);

const PackShape = z.strictObject({
  format: z.literal(1),
  id: PackIdSchema,
  version: SemverSchema,
  kind: PackKindSchema,
  system: SlugSchema.optional(),
  name: ShortTextSchema,
  description: LongTextSchema.optional(),
  authors: z.array(ShortTextSchema).default([]),
  license: z.string().min(1).max(100).optional(),
  attribution: z.string().max(4000).optional(),
  dependencies: z.array(DependencySchema).max(50).default([]),
  locale: LocaleSchema.default('en'),
  translates: DependencySchema.optional(),
  entities: z.array(EntitySchema).max(PACK_LIMITS.maxEntities).default([]),
  overrides: z.array(OverrideSchema).max(500).default([]),
  assets: z.array(AssetSchema).max(PACK_LIMITS.maxAssets).default([]),
  i18n: z.record(LocaleSchema, TranslationStringsSchema).default({}),
  strings: TranslationStringsSchema.optional(),
});

export const PackSchema = PackShape.superRefine((pack, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });

  // namespace rule + uniqueness
  const seen = new Set<string>();
  pack.entities.forEach((e, i) => {
    const parsed = parseEntityId(e.id);
    if (parsed && parsed.packId !== pack.id)
      issue(`Entity "${e.id}" is outside this pack's namespace "${pack.id}"`, ['entities', i, 'id']);
    if (seen.has(e.id)) issue(`Duplicate entity id "${e.id}"`, ['entities', i, 'id']);
    seen.add(e.id);
  });
  pack.overrides.forEach((o, i) => {
    if (parseEntityId(o.target)?.packId === pack.id)
      issue('Overrides may only target other packs; edit own entities directly', ['overrides', i, 'target']);
  });

  const systems = pack.entities.filter((e) => e.type === 'system');
  switch (pack.kind) {
    case 'core':
      if (!pack.system) issue('Core packs must declare "system"', ['system']);
      if (systems.length !== 1) issue('Core packs must define exactly one system entity', ['entities']);
      else if (pack.system && parseEntityId(systems[0]!.id)?.slug !== pack.system)
        issue(`System entity slug must equal the pack's system ("${pack.system}")`, ['entities']);
      break;
    case 'content':
      if (!pack.system) issue('Content packs must declare "system"', ['system']);
      if (systems.length > 0) issue('Content packs may not define system entities', ['entities']);
      break;
    case 'translation':
      if (!pack.translates) issue('Translation packs must declare "translates"', ['translates']);
      if (!pack.strings) issue('Translation packs must provide "strings"', ['strings']);
      if (pack.locale === 'en') issue('Translation packs cannot target the source language "en"', ['locale']);
      if (pack.entities.length > 0 || pack.overrides.length > 0)
        issue('Translation packs carry strings only', ['entities']);
      break;
    case 'theme':
      if (pack.entities.length > 0 || pack.overrides.length > 0) issue('Theme packs carry assets only', ['entities']);
      break;
  }
});
export type Pack = z.infer<typeof PackSchema>;

export interface PackIssue {
  path: string;
  message: string;
}
export type ParsePackResult = { ok: true; pack: Pack } | { ok: false; issues: PackIssue[] };

export function parsePack(input: unknown): ParsePackResult {
  const r = PackSchema.safeParse(input);
  if (r.success) return { ok: true, pack: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
  };
}

export function formatIssues(issues: PackIssue[]): string[] {
  return issues.map((i) => `${i.path}: ${i.message}`);
}
