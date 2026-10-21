import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { buildSanitizedEnv } from "../env/sanitize.ts";

type TokenCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly error: TokenCommandError; readonly ok: false };

const DEFAULT_PROVIDER_STDOUT_MAX_BYTES = 64 * 1024;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Owns environment construction for token-provider subprocesses.
 *
 * Provider children are allowed to inherit execution basics and provider
 * fixture controls, but they must not see ambient opchain/op token state.
 */
export function buildProviderChildEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return buildSanitizedEnv({
    sourceEnv,
    prefixPredicate: (key) =>
      key.startsWith("OPCHAIN_TEST_HELPER_") ||
      key.startsWith("OPCHAIN_TEST_SECURITY_"),
  });
}

/**
 * Raised when a token backend command cannot complete successfully.
 */
export class TokenCommandError extends Error {
  public constructor(
    public readonly reason: "exit" | "start" | "stdout_limit" | "timeout",
    public readonly exitCode?: number,
  ) {
    super(reason);
    this.name = "TokenCommandError";
  }
}

/**
 * Resolves the token-provider command timeout from the parent environment.
 *
 * @returns {number} Timeout in milliseconds.
 */
function resolveProviderTimeoutMs(): number {
  const rawValue = process.env.OPCHAIN_PROVIDER_TIMEOUT_MS;
  if (rawValue === undefined) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  return parsedValue;
}

/**
 * Resolves the token-provider stdout cap from the parent environment.
 *
 * @returns {number} Maximum stdout bytes accepted from a provider child.
 */
function resolveProviderStdoutMaxBytes(): number {
  const rawValue = process.env.OPCHAIN_PROVIDER_STDOUT_MAX_BYTES;
  if (rawValue === undefined) {
    return DEFAULT_PROVIDER_STDOUT_MAX_BYTES;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return DEFAULT_PROVIDER_STDOUT_MAX_BYTES;
  }

  return parsedValue;
}

/**
 * Reads the Node error code when spawnSync attaches one.
 *
 * @param error - Spawn error.
 * @returns {string | undefined} Error code when present.
 */
function getErrorCode(error: Error): string | undefined {
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Grace period after SIGTERM before escalating a stuck provider child to
 * SIGKILL.
 */
const PROVIDER_SIGKILL_GRACE_MS = 2_000;

/**
 * Runs one token backend command with consistent process handling.
 *
 * @param commandPath - Executable path or command name.
 * @param args - Command arguments.
 * @param input - Optional stdin payload.
 * @returns {TokenCommandResult} Command stdout or typed failure.
 */
export function runTokenCommand(
  commandPath: string,
  args: readonly string[],
  input?: string,
): TokenCommandResult {
  const maxBuffer = resolveProviderStdoutMaxBytes();
  const commandResult = spawnSync(commandPath, args, {
    encoding: "utf8",
    env: buildProviderChildEnv(),
    input,
    maxBuffer,
    timeout: resolveProviderTimeoutMs(),
  });

  if (commandResult.error) {
    const errorCode = getErrorCode(commandResult.error);
    if (errorCode === "ETIMEDOUT") {
      return {
        error: new TokenCommandError("timeout"),
        ok: false,
      };
    }

    if (errorCode === "ENOBUFS") {
      return {
        error: new TokenCommandError("stdout_limit"),
        ok: false,
      };
    }

    return {
      error: new TokenCommandError("start"),
      ok: false,
    };
  }

  if (commandResult.status !== 0) {
    return {
      error: new TokenCommandError("exit", commandResult.status ?? 1),
      ok: false,
    };
  }

  if (Buffer.byteLength(commandResult.stdout, "utf8") > maxBuffer) {
    return {
      error: new TokenCommandError("stdout_limit"),
      ok: false,
    };
  }

  return {
    ok: true,
    stdout: commandResult.stdout,
  };
}

/**
 * Runs one token backend command asynchronously under a caller-owned
 * deadline.
 *
 * Unlike {@link runTokenCommand}, the event loop stays responsive: the
 * child is killed when the deadline passes, so a stalled provider is
 * interrupted rather than blocking until `spawnSync` returns. The relay
 * route uses this so its overall deadline covers token resolution.
 *
 * The relative `timeoutMs` becomes an absolute deadline at entry, and
 * an optional caller `deadlineAt` caps it, so setup time never extends
 * the budget. An exhausted budget is refused before spawning.
 *
 * @param commandPath - Executable path or command name.
 * @param args - Command arguments.
 * @param options - Relative timeout, optional absolute deadline, and optional stdin payload.
 * @returns {Promise<TokenCommandResult>} Command stdout or typed failure.
 */
export function runTokenCommandAsync(
  commandPath: string,
  args: readonly string[],
  options: {
    readonly deadlineAt?: number;
    readonly input?: string;
    readonly timeoutMs: number;
  },
): Promise<TokenCommandResult> {
  const deadlineAt = Math.min(
    Date.now() + options.timeoutMs,
    options.deadlineAt ?? Number.POSITIVE_INFINITY,
  );
  const maxBytes = resolveProviderStdoutMaxBytes();
  const env = buildProviderChildEnv();

  return new Promise((resolve) => {
    // Expired work is refused, never started: the check runs after the
    // environment is formed, immediately before the spawn.
    if (deadlineAt - Date.now() <= 0) {
      resolve({ error: new TokenCommandError("timeout"), ok: false });
      return;
    }

    let child: ChildProcess;
    try {
      // D401: the provider runs in opchain's own process group (not
      // detached), so the caller that owns opchain's group reaps it
      // with everything else the relay started.
      child = spawn(commandPath, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ error: new TokenCommandError("start"), ok: false });
      return;
    }

    let stdout = "";
    let stdoutBytes = 0;
    let stdoutOverLimit = false;
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: TokenCommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }

      resolve(result);
    };

    // The deadline escalation kills the direct child only: TERM first,
    // then KILL, and never a KILL to an already-exited (reaped) pid.
    const killDirectChild = (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      child.kill(signal);
    };

    const settleTimedOut = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }

      resolve({ error: new TokenCommandError("timeout"), ok: false });
    };

    timeout = setTimeout(
      () => {
        if (settled) {
          return;
        }

        timedOut = true;
        killDirectChild("SIGTERM");
        // A SIGTERM-ignoring provider still holds the relay deadline, so
        // escalate to an unblockable SIGKILL.
        killTimer = setTimeout(() => {
          killDirectChild("SIGKILL");
        }, PROVIDER_SIGKILL_GRACE_MS);
        // The deadline may outlive the provider: a descendant holding
        // its pipes keeps close from firing, so an already-exited child
        // settles here instead of hanging.
        if (child.exitCode !== null || child.signalCode !== null) {
          settleTimedOut();
        }
      },
      Math.max(0, deadlineAt - Date.now()),
    );

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        stdoutOverLimit = true;
        killDirectChild("SIGKILL");
        return;
      }

      stdout += chunk.toString("utf8");
    });

    child.stderr?.resume();

    child.on("error", (error: Error) => {
      void error;
      finish({ error: new TokenCommandError("start"), ok: false });
    });

    child.on("exit", () => {
      // After a kill, grandchildren may still hold the stdio pipes open,
      // so the killed outcome settles on exit rather than close.
      if (timedOut) {
        finish({ error: new TokenCommandError("timeout"), ok: false });
        return;
      }

      if (stdoutOverLimit) {
        finish({ error: new TokenCommandError("stdout_limit"), ok: false });
      }
    });

    child.on("close", (exitCode) => {
      if (stdoutOverLimit) {
        finish({ error: new TokenCommandError("stdout_limit"), ok: false });
        return;
      }

      if (timedOut) {
        finish({ error: new TokenCommandError("timeout"), ok: false });
        return;
      }

      if (exitCode !== 0) {
        finish({
          error: new TokenCommandError("exit", exitCode ?? 1),
          ok: false,
        });
        return;
      }

      if (Buffer.byteLength(stdout, "utf8") > maxBytes) {
        finish({ error: new TokenCommandError("stdout_limit"), ok: false });
        return;
      }

      // A success that lands after the deadline is a timeout, even when
      // the timer callback has not run yet.
      if (Date.now() >= deadlineAt) {
        finish({ error: new TokenCommandError("timeout"), ok: false });
        return;
      }

      finish({ ok: true, stdout });
    });
  });
}
