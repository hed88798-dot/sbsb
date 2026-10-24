export type ProviderErrorClass =
  | 'RATE_LIMITED'
  | 'UPSTREAM_5XX'
  | 'UNAVAILABLE'
  | 'TIMEOUT_UNKNOWN'
  | 'MODERATION_REJECTED'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_MODEL'
  | 'AUTH_FAILED'
  | 'INTERNAL';

export class ProviderAdapterError extends Error {
  constructor(
    readonly errorClass: ProviderErrorClass,
    message: string,
    readonly retryable: boolean,
    readonly providerJobId?: string,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}
