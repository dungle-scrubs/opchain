import { spawnSync } from "node:child_process";

import {
  createProviderEmptyTokenError,
  createProviderExitCodeError,
  createProviderStartError,
  type TokenProviderResult,
} from "./token-provider.ts";

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
  const commandResult = spawnSync(
    request.helperPath,
    ["get", "--service", request.serviceName, "--account", request.accountName],
    {
      encoding: "utf8",
      env: process.env,
    },
  );

  if (commandResult.error) {
    return {
      error: createProviderStartError("helper"),
      ok: false,
    };
  }

  if (commandResult.status !== 0) {
    return {
      error: createProviderExitCodeError("helper", commandResult.status ?? 1),
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
