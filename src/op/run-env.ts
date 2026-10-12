import { describeOpCommand } from "./reveal-guard.ts";

/** How `op run` arguments are prepared for the delegated child. */
export type RunEnvPlan =
  | { readonly kind: "not-run" }
  | { readonly kind: "no-separator" }
  | { readonly kind: "no-program" }
  | { readonly kind: "strip"; readonly args: readonly string[] };

/**
 * Plans the `op run` program environment.
 *
 * Without `--pass-token`, the program after the first `--` starts through
 * `/usr/bin/env`, which drops `OP_SERVICE_ACCOUNT_TOKEN` and turns off the
 * 1Password app integration, so a program that calls `op` itself fails
 * instead of raising the desktop CLI-access prompt.
 *
 * @param opArgs - Arguments passed after the `op` token.
 * @returns {RunEnvPlan} The plan for this command.
 */
export function planRunEnv(opArgs: readonly string[]): RunEnvPlan {
  if (describeOpCommand(opArgs) !== "run") {
    return { kind: "not-run" };
  }
  const separatorIndex = opArgs.indexOf("--");
  if (separatorIndex === -1) {
    return { kind: "no-separator" };
  }
  if (separatorIndex === opArgs.length - 1) {
    return { kind: "no-program" };
  }
  return {
    kind: "strip",
    args: [
      ...opArgs.slice(0, separatorIndex + 1),
      "/usr/bin/env",
      "-u",
      "OP_SERVICE_ACCOUNT_TOKEN",
      "OP_BIOMETRIC_UNLOCK_ENABLED=false",
      ...opArgs.slice(separatorIndex + 1),
    ],
  };
}
