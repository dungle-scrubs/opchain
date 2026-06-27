const DEFAULT_OP_TIMEOUT_MS = 30_000;

/**
 * Resolves the child `op` timeout from the environment.
 *
 * @returns {number} Timeout in milliseconds.
 */
export function resolveOpTimeoutMs(): number {
  const rawValue = process.env.OPCHAIN_OP_TIMEOUT_MS;
  if (rawValue === undefined) {
    return DEFAULT_OP_TIMEOUT_MS;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return DEFAULT_OP_TIMEOUT_MS;
  }

  return parsedValue;
}

/**
 * Formats a consistent timeout message for delegated `op` commands.
 *
 * @param timeoutMs - Timeout that elapsed.
 * @returns {string} Printable timeout message.
 */
export function formatOpTimeoutMessage(timeoutMs: number): string {
  return `1Password CLI command timed out after ${timeoutMs}ms. Check the local op runtime, account state, and service-account token.`;
}
