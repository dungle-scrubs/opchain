import { spawnSync } from "node:child_process";

type RemoveTokenWithHelperRequest = {
  readonly accountName: string;
  readonly helperPath: string;
  readonly serviceName: string;
};

type RemoveTokenResult =
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
 * Removes a token through the helper backend.
 *
 * @param request - Helper removal request.
 * @returns {Promise<RemoveTokenResult>} Mutation result.
 */
export async function removeTokenWithHelper(
  request: RemoveTokenWithHelperRequest,
): Promise<RemoveTokenResult> {
  const commandResult = spawnSync(
    request.helperPath,
    [
      "remove",
      "--service",
      request.serviceName,
      "--account",
      request.accountName,
    ],
    {
      encoding: "utf8",
      env: process.env,
    },
  );

  if (commandResult.error) {
    return {
      error: new TokenMutationError("helper token remove failed to start."),
      ok: false,
    };
  }

  if (commandResult.status !== 0) {
    return {
      error: new TokenMutationError(
        `helper token remove failed with exit code ${commandResult.status ?? 1}.`,
      ),
      ok: false,
    };
  }

  return { ok: true };
}

export type { RemoveTokenResult, RemoveTokenWithHelperRequest };
