import { resolveToken } from "../token/resolve-token.ts";

import type { AccessOverride, CliOptions } from "./options.ts";
import { resolveSecurityPath } from "./paths.ts";
import type { OpCommandClassification, ResolvedProfile } from "./profile.ts";
import { resolveOpProfile } from "./profile.ts";
import type { RuntimeResult } from "./result.ts";
import { writeTelemetry } from "./telemetry.ts";
import type { ConfigContext } from "./config-context.ts";
import { loadConfigContext } from "./config-context.ts";

export type ResolvedIdentityContext = {
  readonly config: ConfigContext["config"];
  readonly configPath: string;
  readonly resolvedProfile: ResolvedProfile;
  readonly token: string;
};

/**
 * Optional telemetry hooks interleaved with the resolution chain.
 *
 * Callbacks let a caller emit its own events between the config, profile, and
 * token resolution steps without duplicating the pipeline. All hooks are
 * additive and default to undefined so existing callers are unaffected.
 */
export type IdentityContextHooks = {
  readonly onClassified?: () => void;
  readonly onProfileResolved?: (resolvedProfile: ResolvedProfile) => void;
};

/**
 * Resolves a token for one configured account with provider telemetry.
 *
 * @param options - Parsed CLI options.
 * @param accountName - Keychain account name.
 * @param allowEnvToken - Whether the env override is allowed.
 * @returns {Promise<RuntimeResult<string>>} Token or a printable error.
 */
export async function resolveTokenForAccount(
  options: CliOptions,
  accountName: string,
  allowEnvToken: boolean,
): Promise<RuntimeResult<string>> {
  const tokenResult = await resolveToken({
    accountName,
    allowEnvToken,
    emitEvent: (event) => {
      writeTelemetry(options, event);
    },
    securityPath: resolveSecurityPath(),
    serviceName: "opchain",
  });
  if (!tokenResult.ok) {
    return {
      error: tokenResult.error.message,
      ok: false,
    };
  }

  return {
    ok: true,
    value: tokenResult.value,
  };
}

/**
 * Resolves config, profile, and token for one identity-scoped command.
 *
 * @param options - Parsed CLI options.
 * @param request - Identity resolution request.
 * @param hooks - Optional telemetry hooks fired between resolution steps.
 * @returns {Promise<RuntimeResult<ResolvedIdentityContext>>} Resolved identity context or a printable error.
 */
export async function resolveIdentityContext(
  options: CliOptions,
  request: {
    readonly accessOverride: AccessOverride | undefined;
    readonly allowEnvToken: boolean;
    readonly classification: OpCommandClassification;
    readonly explicitProfile: string | undefined;
    readonly identityName: string;
  },
  hooks: IdentityContextHooks = {},
): Promise<RuntimeResult<ResolvedIdentityContext>> {
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return configContext;
  }

  hooks.onClassified?.();

  const resolvedProfile = resolveOpProfile(
    configContext.value.config,
    request.identityName,
    request.classification,
    request.accessOverride,
    request.explicitProfile,
  );
  if (typeof resolvedProfile === "string") {
    return {
      error: resolvedProfile,
      ok: false,
    };
  }

  hooks.onProfileResolved?.(resolvedProfile);

  const tokenResult = await resolveTokenForAccount(
    options,
    resolvedProfile.accountName,
    request.allowEnvToken,
  );
  if (!tokenResult.ok) {
    return tokenResult;
  }

  return {
    ok: true,
    value: {
      config: configContext.value.config,
      configPath: configContext.value.configPath,
      resolvedProfile,
      token: tokenResult.value,
    },
  };
}

/**
 * Resolves config, read-safe profile, and token for one identity-scoped read command.
 *
 * @param options - Parsed CLI options.
 * @param identityName - Identity name.
 * @returns {Promise<RuntimeResult<ResolvedIdentityContext>>} Resolved identity context or a printable error.
 */
export async function resolveReadIdentityContext(
  options: CliOptions,
  identityName: string,
): Promise<RuntimeResult<ResolvedIdentityContext>> {
  return resolveIdentityContext(options, {
    accessOverride: undefined,
    allowEnvToken: false,
    classification: "read_safe",
    explicitProfile: undefined,
    identityName,
  });
}
