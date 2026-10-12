import { describeOpCommand } from "./reveal-guard.ts";

export type RunEnvPlan =
  | { readonly kind: "not-run" }
  | { readonly kind: "no-separator" }
  | { readonly kind: "no-program" }
  | { readonly kind: "strip"; readonly args: readonly string[] };

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
      ...opArgs.slice(separatorIndex + 1),
    ],
  };
}
