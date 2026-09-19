/** `POST /api/auth/reset` (ADR-012 §Recovery): username + one-time code → new salt+verifier,
 * burns the code, deletes ALL sessions. */
import { badRequest, unauthorized } from '../errors.ts';
import { sha256Hex } from '../crypto.ts';
import type { Db } from '../db/index.ts';
import type { Config } from '../../ports/index.ts';
import {
  burnRecoveryCode,
  deleteSessionsForUser,
  findUnusedRecoveryCode,
  findUserByFoldedName,
  updateUserCredentials,
} from '../db/queries.ts';
import { foldUsername } from './username.ts';
import { hashVerifier, isValidSalt, isValidVerifierShape } from './verifier.ts';
import { normalizeRecoveryCode } from './recovery-codes.ts';

export interface ResetInput {
  readonly username: string;
  readonly recoveryCode: string;
  readonly newSalt: string;
  readonly newVerifier: string;
}

export interface ResetResult {
  readonly userId: string;
}

const GENERIC_INVALID_MESSAGE = 'Invalid username or recovery code';

export async function resetWithRecoveryCode(
  db: Db,
  config: Config,
  input: ResetInput,
  now = Date.now(),
): Promise<ResetResult> {
  const { username, recoveryCode, newSalt, newVerifier } = input;
  if (typeof username !== 'string' || username.length === 0) throw badRequest('Invalid username');
  if (typeof recoveryCode !== 'string' || recoveryCode.length === 0) throw badRequest('Invalid recovery code');
  if (typeof newSalt !== 'string' || !isValidSalt(newSalt)) throw badRequest('Invalid salt');
  if (typeof newVerifier !== 'string' || !isValidVerifierShape(newVerifier)) throw badRequest('Invalid verifier');

  const folded = foldUsername(username);
  const user = await findUserByFoldedName(db, folded);
  // Generic 401 whether the username or the code is wrong — never reveal which (ADR-012's
  // no-existence-oracle rule extended to recovery, same reasoning as the salt endpoint).
  if (!user) throw unauthorized(GENERIC_INVALID_MESSAGE);

  const codeHash = await sha256Hex(normalizeRecoveryCode(recoveryCode));
  const unused = await findUnusedRecoveryCode(db, user.id, codeHash);
  if (!unused) throw unauthorized(GENERIC_INVALID_MESSAGE);

  const burned = await burnRecoveryCode(db, user.id, codeHash, now);
  if (!burned) throw unauthorized(GENERIC_INVALID_MESSAGE); // lost a race with a concurrent use

  const newVerifierHash = await hashVerifier(config, newVerifier);
  await updateUserCredentials(db, user.id, newSalt.toLowerCase(), newVerifierHash);
  await deleteSessionsForUser(db, user.id); // ADR-012: reset invalidates every session

  return { userId: user.id };
}
