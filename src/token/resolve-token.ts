import {
  createTelemetryEvent,
  type TelemetryEvent,
} from "../telemetry/event.ts";

import { getTokenFromEnvOverride } from "./env-provider.ts";
import { getTokenFromSecurity } from "./security-provider.ts";
import {
  createAggregateProviderError,
  type TokenProviderResult,
} from "./token-provider.ts";

type ResolveTokenRequest = {
  readonly accountName: string;
  readonly allowEnvToken: boolean;
  /**
   * When set, the security provider runs through the cancellable async
   * backend under this timeout, so a caller-owned deadline can bound
   * token resolution.
   */
  readonly commandTimeoutMs?: number;
  /**
   * Absolute deadline timestamp passed through to the security provider,
   * so its spawn and kill timer follow the caller's deadline exactly.
   */
  readonly deadlineAt?: number;
  readonly emitEvent?: (event: TelemetryEvent) => void;
  readonly securityPath: string;
  readonly serviceName: string;
};

/**
 * Emits a provider telemetry event when a sink is configured.
 *
 * @param request - Provider resolution request.
 * @param name - Telemetry event name.
 * @param attributes - Safe provider attributes.
 * @returns {void} Nothing.
 */
function emitProviderEvent(
  request: ResolveTokenRequest,
  name: string,
  attributes: Record<string, unknown>,
): void {
  request.emitEvent?.(createTelemetryEvent(name, attributes));
}

/**
 * Resolves a token through the documented env-override then security provider order.
 *
 * @param request - Provider invocation details.
 * @returns {Promise<TokenProviderResult>} Resolved token result.
 */
export async function resolveToken(
  request: ResolveTokenRequest,
): Promise<TokenProviderResult> {
  if (request.allowEnvToken) {
    emitProviderEvent(request, "token.provider.attempt", {
      provider_name: "env_override",
    });

    const envOverrideResult = getTokenFromEnvOverride({
      allowEnvToken: request.allowEnvToken,
    });

    if (envOverrideResult?.ok) {
      emitProviderEvent(request, "token.provider.success", {
        provider_name: "env_override",
      });
      return envOverrideResult;
    }

    if (envOverrideResult && !envOverrideResult.ok) {
      emitProviderEvent(request, "token.provider.failure", {
        error_message: envOverrideResult.error.message,
        provider_name: "env_override",
      });
      return envOverrideResult;
    }

    emitProviderEvent(request, "token.provider.failure", {
      error_message: "env override provider not configured.",
      provider_name: "env_override",
    });
  }

  emitProviderEvent(request, "token.provider.attempt", {
    provider_name: "security",
  });
  const securityResult = await getTokenFromSecurity({
    accountName: request.accountName,
    commandTimeoutMs: request.commandTimeoutMs,
    deadlineAt: request.deadlineAt,
    securityPath: request.securityPath,
    serviceName: request.serviceName,
  });

  if (securityResult.ok) {
    emitProviderEvent(request, "token.provider.success", {
      provider_name: "security",
    });
    return securityResult;
  }

  emitProviderEvent(request, "token.provider.failure", {
    error_message: securityResult.error.message,
    provider_name: "security",
  });

  return {
    error: createAggregateProviderError([securityResult.error]),
    ok: false,
  };
}

export type { ResolveTokenRequest };
