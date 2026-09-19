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

export function tooManyRequests(message = 'Too many requests'): ApiError {
  return new ApiError(429, 'too_many_requests', message);
}

export function payloadTooLarge(message = 'Payload too large'): ApiError {
  return new ApiError(413, 'payload_too_large', message);
}
