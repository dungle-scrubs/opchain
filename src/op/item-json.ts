import { spawnSync } from "node:child_process";

import { buildTokenChildEnv } from "../cli/child-env.ts";
import { parseJsonText } from "../cli/io.ts";
import { resolveOpTimeoutMs } from "../cli/op-timeout.ts";
import { resolveOpPath } from "../cli/paths.ts";

export type OpItemJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly error: string;
      readonly ok: false;
      readonly reason: "exec" | "parse";
    };

/**
 * Loads one `op item get --format json` payload through the `op` CLI.
 *
 * @param token - Service-account token for the child process.
 * @param selector - Item selector or reference.
 * @param failureMessage - Message returned when the child command fails.
 * @param invalidPayloadMessage - Message returned when the JSON payload is malformed.
 * @returns {OpItemJsonResult} Parsed JSON payload or a printable error.
 */
export function readOpItemJson(
  token: string,
  selector: string,
  failureMessage: string,
  invalidPayloadMessage: string,
): OpItemJsonResult {
  const opResult = spawnSync(
    resolveOpPath(),
    ["item", "get", selector, "--format", "json"],
    {
      encoding: "utf8",
      env: buildTokenChildEnv(token),
      timeout: resolveOpTimeoutMs(),
    },
  );
  if (opResult.error || opResult.status !== 0) {
    return {
      error: failureMessage,
      ok: false,
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
