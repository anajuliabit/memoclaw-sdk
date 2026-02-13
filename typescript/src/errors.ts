/** Error thrown by the MemoClaw SDK when the API returns a non-2xx response. */
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
}

/** Raised on 401 responses. */
export class AuthenticationError extends MemoClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(401, code, message, details);
    this.name = 'AuthenticationError';
  }
}

/** Raised on 402 responses. */
export class PaymentRequiredError extends MemoClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(402, code, message, details);
    this.name = 'PaymentRequiredError';
  }
}

/** Raised on 403 responses. */
export class ForbiddenError extends MemoClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(403, code, message, details);
    this.name = 'ForbiddenError';
  }
}

/** Raised on 404 responses. */
export class NotFoundError extends MemoClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(404, code, message, details);
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
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(429, code, message, details);
    this.name = 'RateLimitError';
  }
}

/** Raised on 500+ responses. */
export class InternalServerError extends MemoClawError {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(status, code, message, details);
    this.name = 'InternalServerError';
  }
}

const STATUS_ERROR_MAP: Record<number, (code: string, message: string, details?: Record<string, unknown>) => MemoClawError> = {
  400: (code, msg, details) => new ValidationError(400, code, msg, details),
  401: (code, msg, details) => new AuthenticationError(code, msg, details),
  402: (code, msg, details) => new PaymentRequiredError(code, msg, details),
  403: (code, msg, details) => new ForbiddenError(code, msg, details),
  404: (code, msg, details) => new NotFoundError(code, msg, details),
  422: (code, msg, details) => new ValidationError(422, code, msg, details),
  429: (code, msg, details) => new RateLimitError(code, msg, details),
  500: (code, msg, details) => new InternalServerError(500, code, msg, details),
  502: (code, msg, details) => new InternalServerError(502, code, msg, details),
  503: (code, msg, details) => new InternalServerError(503, code, msg, details),
  504: (code, msg, details) => new InternalServerError(504, code, msg, details),
};

/** Create the most specific error subclass from an API error response. */
export function createError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): MemoClawError {
  const factory = STATUS_ERROR_MAP[status];
  if (factory) return factory(code, message, details);
  return new MemoClawError(status, code, message, details);
}
