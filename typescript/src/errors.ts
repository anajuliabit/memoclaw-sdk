/**
 * Actionable suggestions keyed by error code.
 * When the SDK throws, `error.suggestion` gives developers a concrete next step.
 */
const ERROR_SUGGESTIONS: Record<string, string> = {
  // Auth
  MISSING_WALLET: 'Pass a wallet address via the `wallet` option, set MEMOCLAW_WALLET env var, or run `memoclaw init`.',
  INVALID_WALLET: 'Ensure the wallet address is a valid Ethereum address (0x-prefixed, 40 hex chars).',
  INVALID_SIGNATURE: 'The signed auth header is invalid. Check that your private key matches the wallet address.',
  AUTH_EXPIRED: 'The authentication timestamp has expired. Ensure your system clock is accurate.',

  // Payment
  FREE_TIER_EXHAUSTED: 'You have used all 100 free API calls. Fund your wallet with USDC on Base to continue. See https://docs.memoclaw.com/payments',
  PAYMENT_REQUIRED: 'This endpoint requires payment. Ensure your wallet has USDC on Base. See https://docs.memoclaw.com/payments',
  INSUFFICIENT_FUNDS: 'Your wallet does not have enough USDC on Base. Top up and retry.',

  // Validation
  CONTENT_TOO_LONG: 'Memory content exceeds the 8192 character limit. Split it into smaller memories or summarize.',
  INVALID_IMPORTANCE: 'Importance must be a number between 0 and 1.',
  INVALID_NAMESPACE: 'Namespace must be alphanumeric with hyphens/underscores, max 64 chars.',
  MISSING_CONTENT: 'The `content` field is required and must be a non-empty string.',
  MISSING_QUERY: 'The `query` field is required for recall/search.',
  BATCH_TOO_LARGE: 'Batch size exceeds the maximum of 100 items. Split into smaller batches.',

  // Not found
  MEMORY_NOT_FOUND: 'No memory exists with that ID. It may have been deleted. Use `client.list()` to browse existing memories.',
  RELATION_NOT_FOUND: 'No relation exists with that ID. Use `client.listRelations(memoryId)` to see existing relations.',

  // Forbidden
  MEMORY_IMMUTABLE: 'This memory is immutable and cannot be modified or deleted.',
  WALLET_MISMATCH: 'You can only access memories belonging to your wallet address.',

  // Rate limit
  RATE_LIMITED: 'You are sending requests too quickly. Back off and retry after the delay indicated in the Retry-After header.',

  // Server
  INTERNAL_ERROR: 'An unexpected server error occurred. Retry in a moment. If it persists, check https://status.memoclaw.com or open an issue.',
  SERVICE_UNAVAILABLE: 'The API is temporarily unavailable. Retry in a few seconds.',
};

/** Fallback suggestions by HTTP status code when no specific error code matches. */
const STATUS_SUGGESTIONS: Record<number, string> = {
  400: 'Check the request body against the API docs: https://docs.memoclaw.com',
  401: 'Verify your wallet address or private key. Run `memoclaw init` to reconfigure.',
  402: 'This request requires payment. Ensure your wallet has USDC on Base. See https://docs.memoclaw.com/payments',
  403: 'You do not have permission for this resource. Check the wallet address and memory ownership.',
  404: 'The requested resource was not found. Verify the ID and that it has not been deleted.',
  422: 'The request body has invalid fields. Check types and required fields in the API docs.',
  429: 'Rate limited. Slow down requests or add retry logic with exponential backoff.',
  500: 'Internal server error. Retry shortly. If persistent, report at https://github.com/anajuliabit/memocloud/issues',
  502: 'Bad gateway. The API may be restarting. Retry in a few seconds.',
  503: 'Service unavailable. The API is temporarily down. Retry shortly.',
  504: 'Gateway timeout. The request took too long. Try a smaller batch or simpler query.',
};

/** Look up an actionable suggestion for a given error code and status. */
function getSuggestion(status: number, code: string): string | undefined {
  return ERROR_SUGGESTIONS[code] ?? STATUS_SUGGESTIONS[status];
}

/** Error thrown by the MemoClaw SDK when the API returns a non-2xx response. */
export class MemoClawError extends Error {
  /** Actionable suggestion for how to fix this error. */
  public readonly suggestion?: string;

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MemoClawError';
    this.suggestion = getSuggestion(status, code);
  }

  /** Returns a developer-friendly string including the suggestion when available. */
  override toString(): string {
    let str = `${this.name} [${this.code}] (${this.status}): ${this.message}`;
    if (this.suggestion) str += `\n  → ${this.suggestion}`;
    return str;
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
