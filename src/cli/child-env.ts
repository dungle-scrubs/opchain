import { buildSanitizedEnv } from "../env/sanitize.ts";

/**
 * Builds the environment for `op run`, whose program inherits this environment.
 *
 * The caller's own variables belong to that program. Drop `OP_` and `OPCHAIN_`
 * variables so nothing in the caller's environment can redirect `op` or supply
 * a token, except the test fixture's `OPCHAIN_TEST_OP_` controls. The program
 * itself still starts without the token through `src/op/run-env.ts` unless
 * `--pass-token` is given.
 *
 * @param token - Service-account token to inject into the child process.
 * @param sourceEnv - Caller environment to pass through with op controls removed.
 * @returns {NodeJS.ProcessEnv} Run child process environment.
 */
export function buildRunChildEnv(
  token: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (
      value !== undefined &&
      (key.startsWith("OPCHAIN_TEST_OP_") ||
        (!key.startsWith("OP_") && !key.startsWith("OPCHAIN_")))
    ) {
      env[key] = value;
    }
  }
  env.OP_SERVICE_ACCOUNT_TOKEN = token;
  return env;
}

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
