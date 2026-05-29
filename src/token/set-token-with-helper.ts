import { runTokenCommand } from "./command-backend.ts";

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
  const commandResult = runTokenCommand(
    request.helperPath,
    ["set", "--service", request.serviceName, "--account", request.accountName],
    request.token,
  );

  if (!commandResult.ok && commandResult.error.reason === "start") {
    return {
      error: new TokenMutationError("helper token set failed to start."),
      ok: false,
    };
  }

  if (!commandResult.ok) {
    return {
      error: new TokenMutationError(
        `helper token set failed with exit code ${commandResult.error.exitCode ?? 1}.`,
      ),
      ok: false,
    };
  }

  return { ok: true };
}

export type { SetTokenResult, SetTokenWithHelperRequest };
