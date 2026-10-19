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
 * child is killed when `timeoutMs` elapses, so a stalled provider is
 * interrupted rather than blocking until `spawnSync` returns. The relay
 * route uses this so its overall deadline covers token resolution.
 *
 * @param commandPath - Executable path or command name.
 * @param args - Command arguments.
 * @param options - Deadline timeout and optional stdin payload.
 * @returns {Promise<TokenCommandResult>} Command stdout or typed failure.
 */
export function runTokenCommandAsync(
  commandPath: string,
  args: readonly string[],
  options: { readonly input?: string; readonly timeoutMs: number },
): Promise<TokenCommandResult> {
  const maxBytes = resolveProviderStdoutMaxBytes();

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // Detached: the provider leads its own process group, so a kill can
      // reach shell scripts and their children together. Without the
      // group kill, a stub shell's stalled child would hold the stdout
      // pipe open past the deadline.
      child = spawn(commandPath, args, {
        detached: true,
        env: buildProviderChildEnv(),
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

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The group is gone; fall through to the direct kill.
        }
      }

      child.kill(signal);
    };

    timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      timedOut = true;
      killProcessGroup("SIGTERM");
      // A SIGTERM-ignoring provider still holds the relay deadline, so
      // escalate to an unblockable SIGKILL.
      killTimer = setTimeout(() => {
        killProcessGroup("SIGKILL");
      }, PROVIDER_SIGKILL_GRACE_MS);
    }, options.timeoutMs);

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        stdoutOverLimit = true;
        killProcessGroup("SIGKILL");
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

      finish({ ok: true, stdout });
    });
  });
}
