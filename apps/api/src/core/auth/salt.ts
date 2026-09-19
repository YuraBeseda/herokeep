/** `GET /api/auth/salt?username=` (ADR-012 no-existence-oracle rule). */
import type { Db } from '../db/index.ts';
import type { Config } from '../../ports/index.ts';
import { hmacSha256Hex } from '../crypto.ts';
import { findUserByFoldedName } from '../db/queries.ts';
import { foldUsername } from './username.ts';

/** Returns the real, randomly-generated salt stored at registration for a known user, or a
 * deterministic HMAC-derived salt for an unknown one — both 32-hex-char (16-byte) strings, so a
 * caller cannot tell registered usernames apart from unregistered ones from this response alone.
 * HMAC-SHA256 itself produces 64 hex chars (32 bytes); truncating to the first 32 chars (16
 * bytes) is what makes the fake indistinguishable in shape from a real salt — an untruncated
 * fake would immediately reveal itself by being twice as long. Stable: the same folded username
 * always HMACs to the same fake salt, matching a real user's stability. */
export async function resolveSalt(db: Db, config: Config, username: string): Promise<string> {
  const folded = foldUsername(username);
  const user = await findUserByFoldedName(db, folded);
  if (user) return user.salt;
  const fake = await hmacSha256Hex(config.get('SALT_HMAC_KEY'), folded);
  return fake.slice(0, 32);
}
