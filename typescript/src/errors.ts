/**
 * Error hierarchy for the MemoClaw TypeScript SDK.
 *
 * Mirrors the Python SDK error subclasses so callers can catch specific
 * error types (e.g. `NotFoundError`, `RateLimitError`) instead of
 * checking status codes manually.
 */

/** Base error thrown by the MemoClaw SDK when the API returns a non-2xx response. */
export class MemoClawError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MemoClawError';
  }

  /** Create the most specific error subclass from an HTTP status code. */
  static fromResponse(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): MemoClawError {
    const ErrorClass = STATUS_MAP.get(status) ?? MemoClawError;
    return new ErrorClass(status, code, message, details);
  }
}

/** Raised on 401 responses. */
export class AuthenticationError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'AuthenticationError';
  }
}

/** Raised on 402 responses when x402 payment also fails. */
export class PaymentRequiredError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'PaymentRequiredError';
  }
}

/** Raised on 403 responses. */
export class ForbiddenError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'ForbiddenError';
  }
}

/** Raised on 404 responses. */
export class NotFoundError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'NotFoundError';
  }
}

/** Raised on 400/422 responses. */
export class ValidationError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'ValidationError';
  }
}

/** Raised on 429 responses. */
export class RateLimitError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'RateLimitError';
  }
}

/** Raised on 500 responses. */
export class InternalServerError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'InternalServerError';
  }
}

const STATUS_MAP = new Map<number, typeof MemoClawError>([
  [400, ValidationError],
  [401, AuthenticationError],
  [402, PaymentRequiredError],
  [403, ForbiddenError],
  [404, NotFoundError],
  [422, ValidationError],
  [429, RateLimitError],
  [500, InternalServerError],
]);
