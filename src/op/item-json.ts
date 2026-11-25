import { spawnSync } from "node:child_process";

import { buildTokenChildEnv } from "../cli/child-env.ts";
import { parseJsonText } from "../cli/io.ts";
import { resolveOpTimeoutMs } from "../cli/op-timeout.ts";
import { resolveOpPath } from "../cli/paths.ts";
import { type ChildFailureClass, classifyChildFailure } from "./relay.ts";

export type OpItemJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly error: string;
      readonly ok: false;
      readonly opError: ChildFailureClass;
      readonly reason: "exec";
    }
  | {
      readonly error: string;
      readonly ok: false;
      readonly reason: "parse";
    };

/**
 * Classifies a failed `op item get` with the relay's ordered rules. The text
 * is matched, never copied: op's messages echo the selector. A spawn error
 * reads as unreachable only when it is the timeout.
 */
function classifyItemGetFailure(
  stderr: string,
  spawnError: Error | undefined,
): ChildFailureClass {
  if (spawnError !== undefined) {
    return (spawnError as NodeJS.ErrnoException).code === "ETIMEDOUT"
      ? "unreachable"
      : "unknown";
  }

  return classifyChildFailure(stderr);
}

/**
 * Loads one `op item get --format json` payload through the `op` CLI.
 *
 * @param token - Service-account token for the child process.
 * @param selector - Item selector or reference.
 * @param failureMessage - Message returned when the child command fails.
 * @param invalidPayloadMessage - Message returned when the JSON payload is malformed.
 * @param vault - Optional vault name filter inserted before the separator.
 * @returns {OpItemJsonResult} Parsed JSON payload or a printable error.
 */
export function readOpItemJson(
  token: string,
  selector: string,
  failureMessage: string,
  invalidPayloadMessage: string,
  vault?: string,
): OpItemJsonResult {
  const opArgs = ["item", "get", "--format", "json"];
  if (vault !== undefined) {
    opArgs.push("--vault", vault);
  }
  opArgs.push("--", selector);

  const opResult = spawnSync(resolveOpPath(), opArgs, {
    encoding: "utf8",
    env: buildTokenChildEnv(token),
    timeout: resolveOpTimeoutMs(),
  });
  if (opResult.error || opResult.status !== 0) {
    return {
      error: failureMessage,
      ok: false,
      opError: classifyItemGetFailure(opResult.stderr ?? "", opResult.error),
      reason: "exec",
    };
  }

  const parsedPayload = parseJsonText(opResult.stdout, invalidPayloadMessage);
  if (!parsedPayload.ok) {
    return {
      error: parsedPayload.error,
      ok: false,
      reason: "parse",
    };
  }

  return {
    ok: true,
    value: parsedPayload.value,
  };
}
