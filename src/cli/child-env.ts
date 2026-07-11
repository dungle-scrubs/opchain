import { buildSanitizedEnv } from "../env/sanitize.ts";

/**
 * Owns environment construction for delegated `op` subprocesses.
 *
 * Delegated `op` children receive the resolved service-account token, but
 * not opchain's ambient env-token override.
 *
 * @param token - Service-account token to inject into the child process.
 * @returns {NodeJS.ProcessEnv} Sanitized child process environment.
 */
export function buildTokenChildEnv(
  token: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return buildSanitizedEnv({
    sourceEnv,
    prefixPredicate: (key) => key.startsWith("OPCHAIN_TEST_OP_"),
    extra: { OP_SERVICE_ACCOUNT_TOKEN: token },
  });
}
