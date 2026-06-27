export type RuntimeResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly error: string; readonly ok: false };

export type CommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

/**
 * Creates a successful command result.
 *
 * @param stdout - Text to write to stdout.
 * @returns {CommandResult} Successful command output.
 */
export function commandSuccess(stdout: string = ""): CommandResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout,
  };
}

/**
 * Creates a failed command result.
 *
 * @param stderr - Text to write to stderr.
 * @returns {CommandResult} Failed command output.
 */
export function commandFailure(stderr: string): CommandResult {
  return {
    exitCode: 1,
    stderr,
    stdout: "",
  };
}
