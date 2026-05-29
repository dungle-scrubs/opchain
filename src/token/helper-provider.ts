import {
  createProviderEmptyTokenError,
  createProviderExitCodeError,
  createProviderStartError,
  type TokenProviderResult,
} from "./token-provider.ts";
import { runTokenCommand } from "./command-backend.ts";

type HelperTokenRequest = {
  readonly accountName: string;
  readonly helperPath: string;
  readonly serviceName: string;
};

/**
 * Resolves a token by invoking the native helper backend.
 *
 * @param request - Helper invocation details.
 * @returns {Promise<TokenProviderResult>} Resolved token result.
 */
export async function getTokenFromHelper(
  request: HelperTokenRequest,
): Promise<TokenProviderResult> {
  const commandResult = runTokenCommand(request.helperPath, [
    "get",
    "--service",
    request.serviceName,
    "--account",
    request.accountName,
  ]);

  if (!commandResult.ok && commandResult.error.reason === "start") {
    return {
      error: createProviderStartError("helper"),
      ok: false,
    };
  }

  if (!commandResult.ok) {
    return {
      error: createProviderExitCodeError(
        "helper",
        commandResult.error.exitCode ?? 1,
      ),
      ok: false,
    };
  }

  const token = commandResult.stdout.trim();
  if (token.length === 0) {
    return {
      error: createProviderEmptyTokenError("helper"),
      ok: false,
    };
  }

  return { ok: true, value: token };
}

export type { HelperTokenRequest };
