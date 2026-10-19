import { spawn, type ChildProcess } from "node:child_process";
import { write as fsWriteCallback } from "node:fs";
import { constants as osConstants } from "node:os";

import { buildTokenChildEnv } from "../cli/child-env.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import { resolveOpTimeoutMs } from "../cli/op-timeout.ts";
import { resolveOpPath, resolveSecurityPath } from "../cli/paths.ts";
import { resolveOpProfile } from "../cli/profile.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { createTelemetryEvent } from "../telemetry/event.ts";
import { resolveToken } from "../token/resolve-token.ts";

import {
  classifyChildFailure,
  RELAY_DEBUG_PREFIX,
  RELAY_FAILURE_PREFIX,
  relayOutcomeIdentifier,
  relayOutcomeTelemetryLabel,
  validateRelayCommand,
  type RelayOutcome,
} from "./relay.ts";
import {
  evaluateRelayDescriptor,
  parseRelayFdNumber,
} from "./relay-descriptor.ts";

/**
 * Grace period after SIGTERM before escalating a stuck `op` child to SIGKILL.
 */
const OP_SIGKILL_GRACE_MS = 2_000;

/**
 * Stop signals opchain forwards to the delegated `op` child while it runs.
 */
const STOP_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGTERM",
  "SIGINT",
  "SIGHUP",
];

/**
 * Largest write issued per turn of the descriptor write loop. The loop
 * revisits the deadline between turns, so smaller chunks tighten the
 * deadline check without changing byte-exactness.
 */
const WRITE_CHUNK_BYTES = 64 * 1024;

/**
 * How long the write loop waits between poll turns when the descriptor
 * reports it cannot accept more bytes yet.
 */
const WRITE_POLL_INTERVAL_MS = 20;

/**
 * Largest amount of child stderr retained for classification. The child's
 * stderr is read to EOF in full so it can never block, but only this much
 * is kept in memory: diagnostics are short, and the classifier never
 * needs more.
 */
const STDERR_CLASSIFY_MAX_BYTES = 1024 * 1024;

type RelayChildResult =
  | {
      readonly error: Error;
      readonly ok: false;
    }
  | {
      readonly exitCode: number;
      readonly ok: true;
      readonly stderrText: string;
      readonly stdout: Buffer;
      readonly timedOut: boolean;
    };

/**
 * Maps a signal name to its operating-system number.
 *
 * @param signal - Signal name reported by a child's close event.
 * @returns {number} Signal number, or 0 for a name the table lacks.
 */
function signalNumber(signal: NodeJS.Signals): number {
  const number = (
    osConstants.signals as Record<string, number | undefined>
  )[signal];
  return number ?? 0;
}

/**
 * Runs the relay `op read` child with both output streams captured
 * privately. Nothing the child writes is ever mirrored to opchain's own
 * stdout or stderr.
 *
 * @param opArgs - Exact op argv, `read` plus the reference.
 * @param timeoutMs - Remaining overall relay deadline for this child.
 * @param env - Environment passed to the delegated `op` process.
 * @returns {Promise<RelayChildResult>} Captured child output or spawn error.
 */
function runRelayOpChild(
  opArgs: readonly string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<RelayChildResult> {
  return new Promise((resolve) => {
    // D401: the caller owns the process group. The relay child runs in
    // opchain's own process group (not detached), so a caller that
    // starts opchain with Setpgid and kills the group when the read
    // ends reaps everything the read started - including after a
    // SIGKILL of opchain itself.
    const child: ChildProcess = spawn(resolveOpPath(), opArgs, {
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    // The deadline escalation kills the direct child only: TERM first,
    // then KILL, and never a KILL to an already-exited (reaped) pid.
    const killDirectChild = (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill(signal);
    };

    const signalForwards = new Map<NodeJS.Signals, () => void>();
    for (const stopSignal of STOP_SIGNALS) {
      const forward = (): void => {
        killDirectChild(stopSignal);
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
      timeoutMs <= 0
        ? undefined
        : setTimeout(() => {
            if (settled) {
              return;
            }

            timedOut = true;
            killDirectChild("SIGTERM");
            killTimer = setTimeout(() => {
              if (settled) {
                return;
              }

              killDirectChild("SIGKILL");
            }, OP_SIGKILL_GRACE_MS);
          }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= STDERR_CLASSIFY_MAX_BYTES) {
        stderrChunks.push(chunk);
      }
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      teardown();
      resolve({ error, ok: false });
    });

    child.on("exit", () => {
      // After a kill, grandchildren may still hold the output pipes
      // open, so the timeout outcome settles on exit rather than close.
      if (timedOut && !settled) {
        settled = true;
        teardown();
        resolve({
          exitCode: 1,
          ok: true,
          stderrText: "",
          stdout: Buffer.concat(stdoutChunks),
          timedOut: true,
        });
      }
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      teardown();
      resolve({
        exitCode:
          code ?? (signal !== null ? 128 + signalNumber(signal) : 1),
        ok: true,
        stderrText: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks),
        timedOut,
      });
    });
  });
}

/**
 * One deadline-aware write raced against the relay deadline.
 */
type DeadlineOutcome<T> =
  | { readonly deadline: true }
  | { readonly error: Error }
  | { readonly value: T };

/**
 * Result of one descriptor write turn.
 */
type DescriptorWriteResult = {
  readonly bytesWritten: number;
};

/**
 * Issues one positional write on the descriptor from a threadpool
 * thread, so the event loop stays free to observe the deadline.
 *
 * @param fd - Descriptor number to write to.
 * @param chunk - Bytes to write in this turn.
 * @returns {Promise<DescriptorWriteResult>} Bytes accepted by the descriptor.
 */
function writeDescriptorChunk(
  fd: number,
  chunk: Buffer,
): Promise<DescriptorWriteResult> {
  return new Promise((resolve, reject) => {
    fsWriteCallback(
      fd,
      chunk,
      0,
      chunk.length,
      null,
      (error, bytesWritten) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve({ bytesWritten });
      },
    );
  });
}

/**
 * Races one promise against the relay deadline without leaving the
 * deadline timer alive after the promise settles.
 *
 * @param promise - One deadline-bounded operation.
 * @param deadlineAt - Absolute deadline timestamp.
 * @returns {Promise<DeadlineOutcome<T>>} The operation's value, its error, or the deadline.
 */
function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
): Promise<DeadlineOutcome<T>> {
  return new Promise((resolve) => {
    const delay = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      resolve({ deadline: true });
    }, delay);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ error });
      },
    );
  });
}

/**
 * Writes the buffered value bytes to the descriptor, byte-exact, in a
 * deadline-aware non-blocking loop with poll.
 *
 * Each chunked write either advances, reports EAGAIN/EWOULDBLOCK (the
 * descriptor cannot accept more bytes yet - the loop polls and retries
 * until the deadline), reports EINTR (retried), or fails (EPIPE and
 * friends - `write-failed`). A peer that stops draining therefore hits
 * the deadline rather than erroring or outliving it, and the event loop
 * stays responsive throughout. A prefix may already have been delivered
 * when a write fails or the deadline expires; the descriptor is never
 * closed - the caller owns it.
 *
 * @param fd - Private descriptor number to write to.
 * @param bytes - Buffered value exactly as `op` printed it.
 * @param deadlineAt - Absolute deadline timestamp.
 * @returns {Promise<"written" | "write-failed" | "deadline">} Write outcome.
 */
async function writeValueToDescriptor(
  fd: number,
  bytes: Buffer,
  deadlineAt: number,
): Promise<"written" | "write-failed" | "deadline"> {
  let offset = 0;
  while (offset < bytes.length) {
    if (Date.now() >= deadlineAt) {
      return "deadline";
    }

    const chunkEnd = Math.min(offset + WRITE_CHUNK_BYTES, bytes.length);
    const chunk = bytes.subarray(offset, chunkEnd);
    const outcome = await raceWithDeadline(
      writeDescriptorChunk(fd, chunk),
      deadlineAt,
    );

    if ("deadline" in outcome) {
      return "deadline";
    }

    if ("error" in outcome) {
      const code = (outcome.error as { readonly code?: string }).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
        // Poll: the descriptor may accept bytes again at any moment, so
        // wait one interval and retry, bounded by the deadline.
        const pollMs = Math.min(
          WRITE_POLL_INTERVAL_MS,
          Math.max(0, deadlineAt - Date.now()),
        );
        if (pollMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, pollMs);
          });
        }
        continue;
      }

      return "write-failed";
    }

    offset += outcome.value.bytesWritten;
  }

  return "written";
}

/**
 * Handles `opchain <identity> --read --value-fd <n> op read <ref>`.
 *
 * Relay mode validates the command line on its own, independent of the
 * reveal guard: grammar first, then the fail-closed descriptor checks,
 * all before token resolution, config load, or child spawn. One overall
 * relay deadline (the documented op timeout) then covers token
 * resolution, the `op` child, and the descriptor write. Every failure
 * emits exactly one `opchain: relay: <identifier>` line on stderr and
 * nothing else - never a token, a value, child output, or argv values.
 *
 * @param request - Parsed identity op command with `--value-fd` present.
 * @returns {Promise<CommandResult>} Exit code plus stderr, stdout always empty.
 */
export async function runValueRelay(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for op.\n");
  }

  const { identityName, options } = request;
  const opArgs = request.trailingArgs;
  const rawValueFd = options.valueFd ?? "";

  const finish = (
    outcome: RelayOutcome,
    valueBytes: number,
    detail: { readonly deadlineMs?: number; readonly fd?: number } = {},
  ): CommandResult => {
    writeTelemetry(
      options,
      createTelemetryEvent("op.reveal.fd_relay", {
        form: "read",
        identity: identityName,
        outcome: relayOutcomeTelemetryLabel(outcome),
        value_bytes: valueBytes,
      }),
    );

    if (outcome.kind === "written") {
      return commandSuccess();
    }

    let debugLine = "";
    if (options.debug) {
      const parts: string[] = [];
      if (detail.fd !== undefined) {
        parts.push(`fd=${detail.fd}`);
      }
      if (detail.deadlineMs !== undefined) {
        parts.push(`deadline_ms=${detail.deadlineMs}`);
      }
      if (parts.length > 0) {
        debugLine = `${RELAY_DEBUG_PREFIX} ${parts.join(" ")}\n`;
      }
    }

    return commandFailure(
      `${RELAY_FAILURE_PREFIX} ${relayOutcomeIdentifier(outcome)}\n${debugLine}`,
    );
  };

  // Grammar: validated independently of the reveal guard, before anything
  // else runs. A refusal here resolves no token, loads no config, and
  // spawns no child.
  const command = validateRelayCommand({
    allowReveal: options.allowReveal,
    hasRead: options.accessOverride === "read",
    opArgs,
    passToken: options.passToken,
  });
  if ("check" in command) {
    return finish({ check: command.check, kind: "refused" }, 0);
  }

  // A parse that failed on another flag while --value-fd was present
  // is a malformed relay command line, not a malformed descriptor.
  if (rawValueFd === "" && options.valueFdMalformed !== true) {
    return finish({ check: "grammar", kind: "refused" }, 0);
  }

  // Descriptor checks, fail-closed, in order.
  const fd = parseRelayFdNumber(rawValueFd);
  if (fd === null) {
    return finish(
      { check: "descriptor-not-open", kind: "refused" },
      0,
      { fd: undefined },
    );
  }

  const descriptorCheck = evaluateRelayDescriptor(fd);
  if (descriptorCheck !== null) {
    return finish({ check: descriptorCheck, kind: "refused" }, 0, { fd });
  }

  // One overall relay deadline covers token resolution, the child, and
  // the descriptor write.
  const deadlineMs = resolveOpTimeoutMs();
  const deadlineAt = Date.now() + deadlineMs;
  const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());

  // Identity resolution, staged so config/profile failures and token
  // failures carry their own identifiers. The overall deadline covers
  // configuration loading: a stalled config read expires into `deadline`
  // instead of outliving the relay.
  const configContext = await raceWithDeadline(
    loadConfigContext(options),
    deadlineAt,
  );
  if ("deadline" in configContext) {
    return finish({ kind: "deadline" }, 0, { deadlineMs, fd });
  }

  if ("error" in configContext) {
    return finish({ kind: "resolution", resolutionStage: "config" }, 0, {
      deadlineMs,
      fd,
    });
  }

  const configResult = configContext.value;
  if (!configResult.ok) {
    return finish({ kind: "resolution", resolutionStage: "config" }, 0, {
      deadlineMs,
      fd,
    });
  }

  const resolvedProfile = resolveOpProfile(
    configResult.value.config,
    identityName,
    "read_safe",
    options.accessOverride,
    options.explicitProfile,
  );
  if (typeof resolvedProfile === "string") {
    return finish({ kind: "resolution", resolutionStage: "profile" }, 0, {
      deadlineMs,
      fd,
    });
  }

  const tokenResult = await resolveToken({
    accountName: resolvedProfile.accountName,
    allowEnvToken: options.allowEnvToken,
    commandTimeoutMs: remainingMs(),
    securityPath: resolveSecurityPath(),
    serviceName: "opchain",
  });
  if (!tokenResult.ok) {
    // A provider timeout means the overall deadline elapsed during
    // resolution; anything else is a token failure.
    const stage = remainingMs() === 0 ? "token-deadline" : "token";
    return finish({ kind: "resolution", resolutionStage: stage }, 0, {
      deadlineMs,
      fd,
    });
  }

  if (remainingMs() === 0) {
    return finish(
      { kind: "resolution", resolutionStage: "token-deadline" },
      0,
      { deadlineMs, fd },
    );
  }

  // The `op` child, with both streams captured privately and mirrored
  // nowhere.
  const childResult = await runRelayOpChild(
    ["read", command.reference],
    remainingMs(),
    buildTokenChildEnv(tokenResult.value),
  );
  if (!childResult.ok) {
    return finish({ kind: "spawn" }, 0, { deadlineMs, fd });
  }

  if (childResult.timedOut) {
    return finish({ kind: "child-timeout" }, 0, { deadlineMs, fd });
  }

  if (childResult.exitCode !== 0) {
    return finish(
      {
        failureClass: classifyChildFailure(childResult.stderrText),
        kind: "child-failed",
      },
      0,
      { deadlineMs, fd },
    );
  }

  // Acceptance is exit 0 inside the deadline; only then is anything
  // written, byte-exact as `op` printed it.
  const writeOutcome = await writeValueToDescriptor(
    fd,
    childResult.stdout,
    deadlineAt,
  );
  if (writeOutcome === "deadline") {
    return finish({ kind: "deadline" }, 0, { deadlineMs, fd });
  }

  if (writeOutcome === "write-failed") {
    return finish({ kind: "write-failed" }, 0, { deadlineMs, fd });
  }

  return finish({ kind: "written" }, childResult.stdout.length, {
    deadlineMs,
    fd,
  });
}
