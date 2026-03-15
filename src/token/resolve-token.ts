import {
  createTelemetryEvent,
  type TelemetryEvent,
} from "../telemetry/event.ts";

import { getTokenFromEnvOverride } from "./env-provider.ts";
import { getTokenFromHelper } from "./helper-provider.ts";
import { getTokenFromSecurity } from "./security-provider.ts";
import {
  createAggregateProviderError,
  type TokenProviderResult,
} from "./token-provider.ts";

type ResolveTokenRequest = {
  readonly accountName: string;
  readonly allowEnvToken: boolean;
  readonly emitEvent?: (event: TelemetryEvent) => void;
  readonly helperPath: string;
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
 * Resolves a token through the documented env-override, helper, then security provider order.
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
    provider_name: "helper",
  });
  const helperResult = await getTokenFromHelper({
    accountName: request.accountName,
    helperPath: request.helperPath,
    serviceName: request.serviceName,
  });

  if (helperResult.ok) {
    emitProviderEvent(request, "token.provider.success", {
      provider_name: "helper",
    });
    return helperResult;
  }

  emitProviderEvent(request, "token.provider.failure", {
    error_message: helperResult.error.message,
    provider_name: "helper",
  });

  emitProviderEvent(request, "token.provider.attempt", {
    provider_name: "security",
  });
  const securityResult = await getTokenFromSecurity({
    accountName: request.accountName,
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
    error: createAggregateProviderError([
      helperResult.error,
      securityResult.error,
    ]),
    ok: false,
  };
}

export type { ResolveTokenRequest };
