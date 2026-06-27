const OP_CHILD_ENV_BASE_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "SSH_AUTH_SOCK",
  "TERM",
  "TMPDIR",
  "USER",
] as const;

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
  const env: NodeJS.ProcessEnv = {};

  for (const key of OP_CHILD_ENV_BASE_KEYS) {
    const value = sourceEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value !== undefined && key.startsWith("OPCHAIN_TEST_OP_")) {
      env[key] = value;
    }
  }

  env.OP_SERVICE_ACCOUNT_TOKEN = token;
  return env;
}
