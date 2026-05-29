import { spawnSync } from "node:child_process";

type TokenCommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly error: TokenCommandError; readonly ok: false };

/**
 * Raised when a token backend command cannot complete successfully.
 */
export class TokenCommandError extends Error {
  public constructor(
    public readonly reason: "empty_stdout" | "exit" | "start",
    public readonly exitCode?: number,
  ) {
    super(reason);
    this.name = "TokenCommandError";
  }
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
  const commandResult = spawnSync(commandPath, args, {
    encoding: "utf8",
    env: process.env,
    input,
  });

  if (commandResult.error) {
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

  return {
    ok: true,
    stdout: commandResult.stdout,
  };
}
