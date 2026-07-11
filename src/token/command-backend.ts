import { spawnSync } from "node:child_process";

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
