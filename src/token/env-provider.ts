import {
  TokenProviderError,
  type TokenProviderResult,
} from "./token-provider.ts";

type EnvTokenRequest = {
  readonly allowEnvToken: boolean;
};

/**
 * Resolves a token from the explicit env override path.
 *
 * @param request - Env override configuration.
 * @returns {TokenProviderResult | null} Override token result or null when skipped.
 */
export function getTokenFromEnvOverride(
  request: EnvTokenRequest,
): TokenProviderResult | null {
  if (!request.allowEnvToken) {
    return null;
  }

  const token = process.env.OPCHAIN_TOKEN_OVERRIDE;
  if (token === undefined) {
    return null;
  }

  if (token.length === 0) {
    return {
      error: new TokenProviderError(
        "OPCHAIN_TOKEN_OVERRIDE must be non-empty.",
      ),
      ok: false,
    };
  }

  return { ok: true, value: token };
}

export type { EnvTokenRequest };
