type TokenProviderResult =
  | { readonly ok: true; readonly value: string }
  | { readonly error: TokenProviderError; readonly ok: false };

/**
 * Raised when a token provider cannot return a usable token.
 */
export class TokenProviderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TokenProviderError";
  }
}

/**
 * Raised when a token mutation (set or remove) fails.
 */
export class TokenMutationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TokenMutationError";
  }
}

/**
 * Formats a redacted provider-start failure.
 *
 * @param providerName - Provider label.
 * @returns {TokenProviderError} Redacted provider error.
 */
export function createProviderStartError(
  providerName: string,
): TokenProviderError {
  return new TokenProviderError(`${providerName} provider failed to start.`);
}

/**
 * Formats a redacted provider exit-code failure.
 *
 * @param providerName - Provider label.
 * @param exitCode - Process exit status.
 * @returns {TokenProviderError} Redacted provider error.
 */
export function createProviderExitCodeError(
  providerName: string,
  exitCode: number,
): TokenProviderError {
  return new TokenProviderError(
    `${providerName} provider failed with exit code ${exitCode}.`,
  );
}

/**
 * Formats a redacted provider timeout failure.
 *
 * @param providerName - Provider label.
 * @returns {TokenProviderError} Redacted provider error.
 */
export function createProviderTimeoutError(
  providerName: string,
): TokenProviderError {
  return new TokenProviderError(`${providerName} provider timed out.`);
}

/**
 * Formats a redacted provider stdout-limit failure.
 *
 * @param providerName - Provider label.
 * @returns {TokenProviderError} Redacted provider error.
 */
export function createProviderOutputLimitError(
  providerName: string,
): TokenProviderError {
  return new TokenProviderError(
    `${providerName} provider returned too much output.`,
  );
}

/**
 * Formats a redacted empty-token failure.
 *
 * @param providerName - Provider label.
 * @returns {TokenProviderError} Redacted provider error.
 */
export function createProviderEmptyTokenError(
  providerName: string,
): TokenProviderError {
  return new TokenProviderError(
    `${providerName} provider returned an empty token.`,
  );
}

/**
 * Aggregates multiple provider failures into one redacted error.
 *
 * @param errors - Provider errors in attempt order.
 * @returns {TokenProviderError} Combined redacted provider error.
 */
export function createAggregateProviderError(
  errors: readonly TokenProviderError[],
): TokenProviderError {
  return new TokenProviderError(
    `Token resolution failed. ${errors.map((error) => error.message).join(" ")}`,
  );
}

export type { TokenProviderResult };
