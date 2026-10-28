export type ProviderErrorClass =
  | 'RATE_LIMITED'
  | 'UPSTREAM_5XX'
  | 'UNAVAILABLE'
  | 'TIMEOUT_UNKNOWN'
  | 'MODERATION_REJECTED'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_MODEL'
  | 'AUTH_FAILED'
  | 'QUOTA_EXHAUSTED'
  | 'INTERNAL';

export interface ProviderErrorDiagnostic {
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly providerRequestId?: string;
}

export function isProviderErrorClass(value: unknown): value is ProviderErrorClass {
  return (
    typeof value === 'string' &&
    [
      'RATE_LIMITED',
      'UPSTREAM_5XX',
      'UNAVAILABLE',
      'TIMEOUT_UNKNOWN',
      'MODERATION_REJECTED',
      'INVALID_PARAMS',
      'UNSUPPORTED_MODEL',
      'AUTH_FAILED',
      'QUOTA_EXHAUSTED',
      'INTERNAL',
    ].includes(value)
  );
}

export function sanitizeProviderDiagnostic(value: unknown): ProviderErrorDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const diagnostic: {
    httpStatus?: number;
    providerCode?: string;
    providerRequestId?: string;
  } = {};
  if (
    typeof input.httpStatus === 'number' &&
    Number.isInteger(input.httpStatus) &&
    input.httpStatus >= 100 &&
    input.httpStatus <= 599
  ) {
    diagnostic.httpStatus = input.httpStatus;
  }
  if (
    typeof input.providerCode === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/u.test(input.providerCode)
  ) {
    diagnostic.providerCode = input.providerCode;
  }
  if (
    typeof input.providerRequestId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/u.test(input.providerRequestId)
  ) {
    diagnostic.providerRequestId = input.providerRequestId;
  }
  return Object.keys(diagnostic).length > 0 ? Object.freeze(diagnostic) : undefined;
}

export class ProviderAdapterError extends Error {
  readonly providerDiagnostic?: ProviderErrorDiagnostic;

  constructor(
    readonly errorClass: ProviderErrorClass,
    message: string,
    readonly retryable: boolean,
    readonly providerJobId?: string,
    providerDiagnostic?: ProviderErrorDiagnostic,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
    const safeDiagnostic = sanitizeProviderDiagnostic(providerDiagnostic);
    if (safeDiagnostic) this.providerDiagnostic = safeDiagnostic;
  }
}
