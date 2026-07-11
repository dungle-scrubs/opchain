import { spawn } from "node:child_process";

import { createTelemetryEvent } from "../telemetry/event.ts";

import { buildTokenChildEnv } from "../cli/child-env.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import {
  formatOpTimeoutMessage,
  resolveOpTimeoutMs,
} from "../cli/op-timeout.ts";
import { resolveOpPath } from "../cli/paths.ts";
import { classifyOpCommand } from "../cli/profile.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveIdentityContext } from "../cli/token-context.ts";

/**
 * Grace period after SIGTERM before escalating a stuck `op` child to SIGKILL.
 */
const OP_SIGKILL_GRACE_MS = 2_000;

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
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = (): void => {
      clearTimeout(timeout);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      child.kill("SIGTERM");
      // A SIGTERM-ignoring child still holds the service-account token, so
      // escalate to an unblockable SIGKILL to guarantee the process exits and
      // the result promise settles via the close handler below.
      killTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        child.kill("SIGKILL");
      }, OP_SIGKILL_GRACE_MS);
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
      clearTimers();
      resolve({ error, ok: false });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
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

  const identityContext = await resolveIdentityContext(
    options,
    {
      accessOverride: options.accessOverride,
      allowEnvToken: options.allowEnvToken,
      classification: classification ?? "read_safe",
      explicitProfile: options.explicitProfile,
      identityName,
    },
    {
      onClassified: () => {
        writeTelemetry(
          options,
          createTelemetryEvent("op.command.classify", {
            classification: classification ?? "explicit_profile",
            command_name: opArgs.slice(0, 2).join(" "),
            identity: identityName,
          }),
        );
      },
    },
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const { resolvedProfile, token } = identityContext.value;

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.start", {
      command_name: opArgs.slice(0, 2).join(" "),
      identity: identityName,
      profile: resolvedProfile.profileName,
    }),
  );

  const opResult = await runOpChild(opArgs, token);

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
