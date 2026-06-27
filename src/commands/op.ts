import { spawn } from "node:child_process";

import { createTelemetryEvent } from "../telemetry/event.ts";

import { buildTokenChildEnv } from "../cli/child-env.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import {
  formatOpTimeoutMessage,
  resolveOpTimeoutMs,
} from "../cli/op-timeout.ts";
import { resolveOpPath } from "../cli/paths.ts";
import { classifyOpCommand, resolveOpProfile } from "../cli/profile.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveTokenForAccount } from "../cli/token-context.ts";

type OpChildResult =
  | {
      readonly error: Error;
      readonly ok: false;
    }
  | {
      readonly exitCode: number;
      readonly ok: true;
      readonly stderrBytes: number;
      readonly stdoutBytes: number;
      readonly timedOut: boolean;
    };

/**
 * Runs `op` while streaming output through and retaining only byte counts.
 *
 * @param opArgs - Arguments passed after the `op` token.
 * @param token - Service-account token injected into the child process.
 * @returns {Promise<OpChildResult>} Child exit data or spawn error.
 */
function runOpChild(
  opArgs: readonly string[],
  token: string,
): Promise<OpChildResult> {
  return new Promise((resolve) => {
    const timeoutMs = resolveOpTimeoutMs();
    const child = spawn(resolveOpPath(), opArgs, {
      env: buildTokenChildEnv(token),
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({ error, ok: false });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        ok: true,
        stderrBytes,
        stdoutBytes,
        timedOut,
      });
    });
  });
}

/**
 * Handles `opchain <identity> op ...` for the current read-safe slice.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runIdentityOp(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for op.\n");
  }

  const { identityName, options } = request;
  const opArgs = request.trailingArgs;
  const classification = classifyOpCommand(opArgs);

  if (
    classification === null &&
    options.accessOverride === undefined &&
    options.explicitProfile === undefined
  ) {
    return commandFailure(
      "Unsupported op command shape. Explicit profile selection is required.\n",
    );
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.command.classify", {
      classification: classification ?? "explicit_profile",
      command_name: opArgs.slice(0, 2).join(" "),
      identity: identityName,
    }),
  );

  const resolvedProfile = resolveOpProfile(
    configContext.value.config,
    identityName,
    classification ?? "read_safe",
    options.accessOverride,
    options.explicitProfile,
  );
  if (typeof resolvedProfile === "string") {
    return commandFailure(`${resolvedProfile}\n`);
  }

  const tokenResult = await resolveTokenForAccount(
    options,
    resolvedProfile.accountName,
    options.allowEnvToken,
  );
  if (!tokenResult.ok) {
    return commandFailure(`${tokenResult.error}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.start", {
      command_name: opArgs.slice(0, 2).join(" "),
      identity: identityName,
      profile: resolvedProfile.profileName,
    }),
  );

  const opResult = await runOpChild(opArgs, tokenResult.value);

  if (!opResult.ok) {
    return commandFailure(`${opResult.error.message}\n`);
  }

  if (opResult.timedOut) {
    return commandFailure(`${formatOpTimeoutMessage(resolveOpTimeoutMs())}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.finish", {
      command_name: opArgs.slice(0, 2).join(" "),
      exit_code: opResult.exitCode,
      identity: identityName,
      profile: resolvedProfile.profileName,
      stderr_bytes: opResult.stderrBytes,
      stdout_bytes: opResult.stdoutBytes,
    }),
  );

  return {
    ...commandSuccess(),
    exitCode: opResult.exitCode,
  };
}
