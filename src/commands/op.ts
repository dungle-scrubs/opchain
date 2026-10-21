import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";

import { createTelemetryEvent } from "../telemetry/event.ts";
import {
  describeOpCommand,
  detectRevealForm,
  type RevealForm,
} from "../op/reveal-guard.ts";

import { planRunEnv } from "../op/run-env.ts";
import { runValueRelay } from "../op/relay-run.ts";

import { buildRunChildEnv, buildTokenChildEnv } from "../cli/child-env.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import type { CliOptions } from "../cli/options.ts";
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

/**
 * Stop signals opchain forwards to the delegated `op` child while it runs,
 * so Ctrl+C or a hangup reaches `op` and its wrapped program instead of
 * killing opchain and orphaning them.
 */
const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];

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
 * Maps a signal name to its operating-system number.
 *
 * @param signal - Signal name reported by a child's close event.
 * @returns {number} Signal number, or 0 for a name the table lacks.
 */
function signalNumber(signal: NodeJS.Signals): number {
  const number = (osConstants.signals as Record<string, number | undefined>)[
    signal
  ];
  return number ?? 0;
}

/**
 * Runs `op` while streaming output through and retaining only byte counts.
 *
 * @param opArgs - Arguments passed after the `op` token.
 * @param timeoutMs - Kill deadline, or `null` for no deadline.
 * @param env - Environment passed to the delegated `op` process.
 * @returns {Promise<OpChildResult>} Child exit data or spawn error.
 */
function runOpChild(
  opArgs: readonly string[],
  timeoutMs: number | null,
  env: NodeJS.ProcessEnv,
): Promise<OpChildResult> {
  return new Promise((resolve) => {
    const child = spawn(resolveOpPath(), opArgs, {
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    // Stop signals are forwarded to the child, and opchain keeps running
    // until the child ends, so it can report the child's status.
    const signalForwards = new Map<NodeJS.Signals, () => void>();
    for (const stopSignal of STOP_SIGNALS) {
      const forward = (): void => {
        child.kill(stopSignal);
      };
      process.on(stopSignal, forward);
      signalForwards.set(stopSignal, forward);
    }
    const teardown = (): void => {
      for (const [stopSignal, forward] of signalForwards) {
        process.removeListener(stopSignal, forward);
      }
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
    };
    const timeout =
      timeoutMs === null
        ? undefined
        : setTimeout(() => {
            if (settled) {
              return;
            }

            timedOut = true;
            child.kill("SIGTERM");
            // A SIGTERM-ignoring child still holds the service-account
            // token, so escalate to an unblockable SIGKILL to guarantee the
            // process exits and the result promise settles via the close
            // handler below.
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
      teardown();
      resolve({ error, ok: false });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      teardown();
      resolve({
        // A child ended by a signal reports the shell convention 128 + its
        // operating-system signal number, so callers see why `op` died.
        exitCode: code ?? (signal !== null ? 128 + signalNumber(signal) : 1),
        ok: true,
        stderrBytes,
        stdoutBytes,
        timedOut,
      });
    });
  });
}

/**
 * Renders the refusal message for one reveal form.
 *
 * The message names the safe alternative and never echoes argument values
 * from the refused command line.
 *
 * @param revealForm - Refused reveal form.
 * @returns {string} Printable refusal message.
 */
function formatRevealRefusal(revealForm: RevealForm): string {
  const headline =
    revealForm.form === "unclassifiable-order"
      ? "Refused: opchain cannot tell whether this op command prints secret values."
      : `Refused: this op command prints secret values (${revealForm.form}).`;

  return `${headline} ${revealForm.alternative}\nTo run it anyway from an interactive terminal, pass --allow-reveal before \`op\`.\n`;
}

/**
 * Applies the reveal guard to one `op` invocation.
 *
 * Runs before profile classification, config loading, token resolution, and
 * spawning, so a refused command resolves no token and starts no child. With
 * `--allow-reveal` the command still requires an interactive stdin; stdout may
 * stay piped.
 *
 * @param identityName - Selected identity name.
 * @param options - Parsed CLI options.
 * @param opArgs - Arguments passed after the `op` token.
 * @returns {CommandResult | null} Refusal result or null to continue.
 */
function applyRevealGuard(
  identityName: string,
  options: CliOptions,
  opArgs: readonly string[],
): CommandResult | null {
  const revealForm = detectRevealForm(opArgs, process.cwd());
  if (revealForm === null) {
    return null;
  }

  if (!options.allowReveal) {
    writeTelemetry(
      options,
      createTelemetryEvent("op.reveal.refused", {
        form: revealForm.form,
        identity: identityName,
        reason: "reveal",
      }),
    );
    return commandFailure(formatRevealRefusal(revealForm));
  }

  if (process.stdin.isTTY !== true) {
    writeTelemetry(
      options,
      createTelemetryEvent("op.reveal.refused", {
        form: revealForm.form,
        identity: identityName,
        reason: "no_tty",
      }),
    );
    return commandFailure(
      "--allow-reveal requires an interactive terminal (stdin is not a TTY).\n",
    );
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.reveal.allowed", {
      form: revealForm.form,
      identity: identityName,
    }),
  );
  return null;
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

  // Relay mode (`--value-fd`) validates the command line on its own,
  // independently of the reveal guard below. Intent alone is enough:
  // even a line option parsing refused routes here, so the refusal
  // renders as one anchored relay identifier.
  if (
    request.options.valueFd !== undefined ||
    request.options.valueFdIntent === true
  ) {
    return runValueRelay(request);
  }

  const { identityName, options } = request;
  const opArgs = request.trailingArgs;

  const refusal = applyRevealGuard(identityName, options, opArgs);
  if (refusal !== null) {
    return refusal;
  }

  const runPlan = planRunEnv(opArgs);
  if (options.passToken && runPlan.kind === "not-run") {
    return commandFailure("--pass-token applies only to op run.\n");
  }
  if (options.passToken) {
    writeTelemetry(
      options,
      createTelemetryEvent("op.run.token_passed", { identity: identityName }),
    );
  }
  if (!options.passToken && runPlan.kind === "no-separator") {
    return commandFailure(
      "op run needs `--` before the program so opchain can keep the service-account token out of its environment: opchain <identity> op run [flags] -- <program>. Pass --pass-token before `op` if the program calls op itself.\n",
    );
  }
  const childArgs =
    !options.passToken && runPlan.kind === "strip" ? runPlan.args : opArgs;

  const commandName = describeOpCommand(opArgs);
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
            command_name: commandName,
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
      command_name: commandName,
      identity: identityName,
      profile: resolvedProfile.profileName,
    }),
  );

  // `op run` lives as long as the program it wraps, so a deadline would cap
  // that program's runtime rather than catch a stuck `op`.
  const timeoutMs = commandName === "run" ? null : resolveOpTimeoutMs();
  const opResult = await runOpChild(
    childArgs,
    timeoutMs,
    commandName === "run" ? buildRunChildEnv(token) : buildTokenChildEnv(token),
  );

  if (!opResult.ok) {
    return commandFailure(`${opResult.error.message}\n`);
  }

  if (opResult.timedOut) {
    return commandFailure(`${formatOpTimeoutMessage(resolveOpTimeoutMs())}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.finish", {
      command_name: commandName,
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
