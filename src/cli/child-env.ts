/**
 * Builds the environment for child `op` processes.
 *
 * @param token - Service-account token to inject into the child process.
 * @returns {NodeJS.ProcessEnv} Sanitized child process environment.
 */
export function buildTokenChildEnv(token: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPCHAIN_TOKEN_OVERRIDE;
  env.OP_SERVICE_ACCOUNT_TOKEN = token;
  return env;
}
