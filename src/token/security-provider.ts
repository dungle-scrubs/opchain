import {
  createProviderEmptyTokenError,
  createProviderExitCodeError,
  createProviderStartError,
  type TokenProviderResult,
} from "./token-provider.ts";
import { runTokenCommand } from "./command-backend.ts";

type SecurityTokenRequest = {
  readonly accountName: string;
  readonly securityPath: string;
  readonly serviceName: string;
};

/**
 * Resolves a token by invoking the `/usr/bin/security` fallback backend.
 *
 * @param request - Security invocation details.
 * @returns {Promise<TokenProviderResult>} Resolved token result.
 */
export async function getTokenFromSecurity(
  request: SecurityTokenRequest,
): Promise<TokenProviderResult> {
  const commandResult = runTokenCommand(request.securityPath, [
    "find-generic-password",
    "-w",
    "-s",
    request.serviceName,
    "-a",
    request.accountName,
  ]);

  if (!commandResult.ok && commandResult.error.reason === "start") {
    return {
      error: createProviderStartError("security"),
      ok: false,
    };
  }

  if (!commandResult.ok) {
    return {
      error: createProviderExitCodeError(
        "security",
        commandResult.error.exitCode ?? 1,
      ),
      ok: false,
    };
  }

  const token = commandResult.stdout.trim();
  if (token.length === 0) {
    return {
      error: createProviderEmptyTokenError("security"),
      ok: false,
    };
  }

  return { ok: true, value: token };
}

export type { SecurityTokenRequest };
