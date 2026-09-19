/** `POST /api/auth/register` (ADR-012, Task 4 brief — single-step: the client generates its own
 * 16-byte salt and sends it alongside the 32-byte verifier; doc-08's two-step sequence diagram
 * is superseded here by the Global Constraints bullet's exact single-request shape, which this
 * task treats as binding). */
import { badRequest, conflict } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import { sha256Hex } from '../crypto.ts';
import type { Db } from '../db/index.ts';
import type { Config } from '../../ports/index.ts';
import { findUserByFoldedName, insertRecoveryCodes, insertUser } from '../db/queries.ts';
import { foldUsername, isValidUsername } from './username.ts';
import { hashVerifier, isValidSalt, isValidVerifierShape } from './verifier.ts';
import { formatRecoveryCode, normalizeRecoveryCode, randomRecoveryCode } from './recovery-codes.ts';

const RECOVERY_CODE_COUNT = 6;

export interface RegisterInput {
  readonly username: string;
  readonly verifier: string;
  readonly salt: string;
}

export interface RegisterResult {
  readonly userId: string;
  /** Grouped display form (`XXXXX-XXXXX`) — returned ONCE, here, and never again. */
  readonly recoveryCodes: string[];
}

export async function registerUser(
  db: Db,
  config: Config,
  input: RegisterInput,
  now = Date.now(),
): Promise<RegisterResult> {
  const { username, verifier, salt } = input;
  if (typeof username !== 'string' || !isValidUsername(username)) throw badRequest('Invalid username');
  if (typeof salt !== 'string' || !isValidSalt(salt)) throw badRequest('Invalid salt');
  if (typeof verifier !== 'string' || !isValidVerifierShape(verifier)) throw badRequest('Invalid verifier');

  const usernameFolded = foldUsername(username);
  if (await findUserByFoldedName(db, usernameFolded)) throw conflict('Username already taken');

  const verifierHash = await hashVerifier(config, verifier);
  const userId = uuidv7();

  try {
    await insertUser(db, {
      id: userId,
      username,
      usernameFolded,
      salt: salt.toLowerCase(),
      verifierHash,
      createdAt: now,
    });
  } catch {
    // Unique-index race: another request registered the same folded username between the
    // findUserByFoldedName check above and this insert. Report the same 409, not a raw DB error.
    throw conflict('Username already taken');
  }

  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
  const hashedCodes = await Promise.all(
    rawCodes.map(async (code) => ({
      userId,
      codeHash: await sha256Hex(normalizeRecoveryCode(code)),
      usedAt: null,
    })),
  );
  await insertRecoveryCodes(db, hashedCodes);

  return { userId, recoveryCodes: rawCodes.map(formatRecoveryCode) };
}
