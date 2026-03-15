import { spawnSync } from "node:child_process";

import {
  createProviderEmptyTokenError,
  createProviderExitCodeError,
  createProviderStartError,
  type TokenProviderResult,
} from "./token-provider.ts";

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
  const commandResult = spawnSync(
    request.securityPath,
    [
      "find-generic-password",
      "-w",
      "-s",
      request.serviceName,
      "-a",
      request.accountName,
    ],
    {
      encoding: "utf8",
      env: process.env,
    },
  );

  if (commandResult.error) {
    return {
      error: createProviderStartError("security"),
      ok: false,
    };
  }

  if (commandResult.status !== 0) {
    return {
      error: createProviderExitCodeError("security", commandResult.status ?? 1),
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
