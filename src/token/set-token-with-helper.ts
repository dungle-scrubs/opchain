import { spawnSync } from "node:child_process";

type SetTokenWithHelperRequest = {
  readonly accountName: string;
  readonly helperPath: string;
  readonly serviceName: string;
  readonly token: string;
};

type SetTokenResult =
  | { readonly ok: true }
  | { readonly error: TokenMutationError; readonly ok: false };

/**
 * Raised when token mutation fails.
 */
export class TokenMutationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TokenMutationError";
  }
}

/**
 * Stores a token through the helper backend using stdin rather than argv.
 *
 * @param request - Helper write request.
 * @returns {Promise<SetTokenResult>} Mutation result.
 */
export async function setTokenWithHelper(
  request: SetTokenWithHelperRequest,
): Promise<SetTokenResult> {
  const commandResult = spawnSync(
    request.helperPath,
    ["set", "--service", request.serviceName, "--account", request.accountName],
    {
      encoding: "utf8",
      env: process.env,
      input: request.token,
    },
  );

  if (commandResult.error) {
    return {
      error: new TokenMutationError("helper token set failed to start."),
      ok: false,
    };
  }

  if (commandResult.status !== 0) {
    return {
      error: new TokenMutationError(
        `helper token set failed with exit code ${commandResult.status ?? 1}.`,
      ),
      ok: false,
    };
  }

  return { ok: true };
}

export type { SetTokenResult, SetTokenWithHelperRequest };
