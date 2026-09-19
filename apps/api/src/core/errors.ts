/**
 * The backend's one error taxonomy. Routes throw an `ApiError`; the app-level error handler
 * (wired in `core/app.ts`, Task 6) maps `status`/`code` onto an HTTP response. `code` is a
 * stable machine-readable string (never surfaced through a user-visible string literal per
 * CLAUDE.md rule 2 — these are protocol/log identifiers, not i18n text).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message = 'Bad request'): ApiError {
  return new ApiError(400, 'bad_request', message);
}

export function unauthorized(message = 'Unauthorized'): ApiError {
  return new ApiError(401, 'unauthorized', message);
}

export function forbidden(message = 'Forbidden'): ApiError {
  return new ApiError(403, 'forbidden', message);
}

export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, 'not_found', message);
}

export function conflict(message = 'Conflict'): ApiError {
  return new ApiError(409, 'conflict', message);
}

/** A distinct 409 from `conflict` — same status (doc-10/task-6-brief: "honest 409/limit error"),
 * a different `code` so a client can tell "you hit a quota" apart from "that id/name is already
 * taken" without parsing `message` (used by `POST /api/characters`'s 50-character cap, ADR-012). */
export function limitExceeded(message = 'Limit exceeded'): ApiError {
  return new ApiError(409, 'limit_exceeded', message);
}

/** A third distinct 409, alongside `conflict`/`limitExceeded`: the per-user BYTE quota (doc-08
 * "User total" row's 10 MB half, `quotas.ts`'s `USER_QUOTA_BYTES_MAX`) is a different failure
 * from the character-COUNT cap (`limitExceeded`) even though both are checked in the same
 * `POST /api/characters` handler — a client should be able to tell "you're over your storage
 * budget" apart from "you have too many characters" without parsing `message`. */
export function quotaExceeded(message = 'Quota exceeded'): ApiError {
  return new ApiError(409, 'quota_exceeded', message);
}

export function tooManyRequests(message = 'Too many requests'): ApiError {
  return new ApiError(429, 'too_many_requests', message);
}

export function payloadTooLarge(message = 'Payload too large'): ApiError {
  return new ApiError(413, 'payload_too_large', message);
}
