/** `POST /api/auth/recovery-codes`: a signed-in user re-enters their password and gets 6 fresh
 * recovery codes; every older code stops working. */
import { unauthorized } from '../errors.ts';
import { sha256Hex } from '../crypto.ts';
import type { Db } from '../db/index.ts';
import type { Config, RateLimit } from '../../ports/index.ts';
import { findUserById, replaceRecoveryCodes } from '../db/queries.ts';
import { verifyPassword } from './login.ts';
import { formatRecoveryCode, normalizeRecoveryCode, randomRecoveryCode } from './recovery-codes.ts';
import { RECOVERY_CODE_COUNT } from './register.ts';

export async function regenerateRecoveryCodes(
  db: Db,
  config: Config,
  rateLimit: RateLimit,
  userId: string,
  verifier: string,
): Promise<string[]> {
  const user = await findUserById(db, userId);
  if (!user) throw unauthorized('Invalid username or password');
  // A session alone is not enough: the password is checked exactly as `/login` checks it.
  await verifyPassword(db, config, rateLimit, user.username, verifier);

  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
  const rows = await Promise.all(
    rawCodes.map(async (code) => ({ userId, codeHash: await sha256Hex(normalizeRecoveryCode(code)), usedAt: null })),
  );
  await replaceRecoveryCodes(db, userId, rows);
  return rawCodes.map(formatRecoveryCode);
}
