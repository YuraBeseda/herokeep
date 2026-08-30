import { z } from 'zod';

export const SemverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, 'Expected semver x.y.z');
export const BlobHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A pack asset hash or a bundled game-icons id (gi:<slug>). */
export const IconRefSchema = z.union([BlobHashSchema, z.string().regex(/^gi:[a-z0-9][a-z0-9-]*$/)]);
/** NdS(+/-M), e.g. 1d8, 2d6+3, 8d6 */
export const DiceSchema = z.string().regex(/^\d{1,2}d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/);
export const TagSchema = z.string().min(1).max(64);
