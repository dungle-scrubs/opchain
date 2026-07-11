/**
 * Base allowlist of environment variables that sanitized child processes may
 * inherit from the parent environment.
 *
 * This is the single most security-sensitive constant in the codebase: any
 * variable not on this list (and not matched by a caller-supplied passthrough
 * predicate) is stripped, so child `op` and token-provider processes never see
 * ambient secrets or token overrides. Every consumer MUST build its child env
 * through {@link buildSanitizedEnv} so the allowlist cannot diverge.
 */
export const BASE_ENV_ALLOWLIST = [
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
 * Options controlling sanitized child-environment construction.
 */
type BuildSanitizedEnvOptions = {
  /** Parent environment to sanitize. */
  readonly sourceEnv: NodeJS.ProcessEnv;
  /**
   * Predicate deciding whether a non-allowlisted variable name may pass
   * through. Used for narrowly-scoped fixture/test controls.
   */
  readonly prefixPredicate?: (key: string) => boolean;
  /**
   * Additional variables to inject into the child env after allowlisting
   * (e.g. `OP_SERVICE_ACCOUNT_TOKEN`). Injected values always win.
   */
  readonly extra?: Readonly<Record<string, string>>;
};

/**
 * Builds a deny-by-default sanitized child-process environment.
 *
 * A variable is included only when it is on {@link BASE_ENV_ALLOWLIST}, or the
 * caller-supplied `prefixPredicate` accepts its name. Injected `extra` values
 * are applied last and override anything carried over from the source env.
 *
 * @param options - Source env, optional passthrough predicate, and injected vars.
 * @returns {NodeJS.ProcessEnv} Sanitized child process environment.
 */
export function buildSanitizedEnv(
  options: BuildSanitizedEnvOptions,
): NodeJS.ProcessEnv {
  const { sourceEnv, prefixPredicate, extra } = options;
  const env: NodeJS.ProcessEnv = {};

  for (const key of BASE_ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (prefixPredicate !== undefined) {
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (value !== undefined && prefixPredicate(key)) {
        env[key] = value;
      }
    }
  }

  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }

  return env;
}
