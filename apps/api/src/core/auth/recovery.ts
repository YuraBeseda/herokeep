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

// Fixed, structurally-valid-but-never-real user id: when the username doesn't exist, the
// recovery-code lookup below still runs against this id (guaranteed to match zero rows) so the
// unknown-username path does the SAME query work as a known-username-wrong-code path, rather
// than short-circuiting before it. Same reasoning as login.ts's DUMMY_VERIFIER_HASH — without
// this, an unknown username skips a DB round trip that a known one always makes, which is
// exactly the kind of timing/shape difference ADR-012's no-existence-oracle rule exists to close.
const DUMMY_USER_ID = '00000000-0000-7000-8000-000000000000';

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

  // Always hash the code and run the recovery-code lookup — even for an unknown username,
  // against the fixed nonexistent `DUMMY_USER_ID` — so control flow (and the DB work behind it)
  // is identical whether or not the account exists, ahead of the generic 401 below. Mirrors
  // login.ts's dummy-hash compare; extends the same no-existence-oracle rule to reset.
  const codeHash = await sha256Hex(normalizeRecoveryCode(recoveryCode));
  const lookupUserId = user?.id ?? DUMMY_USER_ID;
  const unused = await findUnusedRecoveryCode(db, lookupUserId, codeHash);
  // `unused` can only be defined when `user` is too (the lookup used a real id in that case) —
  // the `!user` re-check exists purely so TypeScript narrows `user` below, same pattern as
  // login.ts's post-`matches` re-check.
  if (!user || !unused) throw unauthorized(GENERIC_INVALID_MESSAGE);

  const burned = await burnRecoveryCode(db, user.id, codeHash, now);
  if (!burned) throw unauthorized(GENERIC_INVALID_MESSAGE); // lost a race with a concurrent use

  const newVerifierHash = await hashVerifier(config, newVerifier);
  await updateUserCredentials(db, user.id, newSalt.toLowerCase(), newVerifierHash);
  await deleteSessionsForUser(db, user.id); // ADR-012: reset invalidates every session

  return { userId: user.id };
}
