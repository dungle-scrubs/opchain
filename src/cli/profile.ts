import type { Config } from "../config/load-config.ts";

import type { AccessOverride } from "./options.ts";

export type OpCommandClassification = "read_safe";

export type ResolvedProfile = {
  readonly accountName: string;
  readonly profileName: string;
};

/**
 * Classifies one `op` command shape.
 *
 * @param opArgs - Arguments passed after the `op` token.
 * @returns {OpCommandClassification | null} Command classification or null when unsupported.
 */
export function classifyOpCommand(
  opArgs: readonly string[],
): OpCommandClassification | null {
  if (opArgs.length === 2 && opArgs[0] === "vault" && opArgs[1] === "list") {
    return "read_safe";
  }

  return null;
}

/**
 * Resolves the profile used for one `op` execution.
 *
 * @param config - Loaded runtime config.
 * @param identityName - Selected identity name.
 * @param classification - Classified command shape.
 * @param accessOverride - Explicit read/write override.
 * @param explicitProfile - Explicit profile name override.
 * @returns {ResolvedProfile | string} Profile resolution result or an error.
 */
export function resolveOpProfile(
  config: Config,
  identityName: string,
  classification: OpCommandClassification,
  accessOverride: AccessOverride | undefined,
  explicitProfile: string | undefined,
): ResolvedProfile | string {
  const identity = config.identities[identityName];
  if (identity === undefined) {
    return `Unknown identity: ${identityName}.`;
  }

  if (explicitProfile !== undefined) {
    const namedProfile = identity.profiles[explicitProfile];
    if (namedProfile === undefined) {
      return `Identity ${identityName} does not define profile ${explicitProfile}.`;
    }

    return {
      accountName: namedProfile.keychainAccount,
      profileName: explicitProfile,
    };
  }

  if (accessOverride !== undefined) {
    const overriddenProfile = identity.profiles[accessOverride];
    if (overriddenProfile === undefined) {
      return `Identity ${identityName} does not define a ${accessOverride} profile.`;
    }

    return {
      accountName: overriddenProfile.keychainAccount,
      profileName: accessOverride,
    };
  }

  const profileNames = Object.keys(identity.profiles);
  if (profileNames.length === 1) {
    const profileName = profileNames[0];
    if (profileName === undefined) {
      return `Identity ${identityName} requires explicit profile selection, which is not implemented yet.`;
    }

    const profile = identity.profiles[profileName];
    if (profile === undefined) {
      return `Unknown profile for ${identityName}: ${profileName}.`;
    }

    return {
      accountName: profile.keychainAccount,
      profileName,
    };
  }

  if (identity.defaultMode === "auto" && classification === "read_safe") {
    const readProfile = identity.profiles.read;
    if (readProfile === undefined) {
      return `Identity ${identityName} does not define a read profile.`;
    }

    return {
      accountName: readProfile.keychainAccount,
      profileName: "read",
    };
  }

  return `Identity ${identityName} requires explicit profile selection, which is not implemented yet.`;
}

/**
 * Resolves the configured keychain account for one identity/profile pair.
 *
 * @param config - Loaded runtime config.
 * @param identityName - Selected identity name.
 * @param profileName - Selected profile name.
 * @returns {{ readonly accountName: string } | string} Account name or an error message.
 */
export function resolveConfiguredAccount(
  config: Config,
  identityName: string,
  profileName: string,
): { readonly accountName: string } | string {
  const identity = config.identities[identityName];
  if (identity === undefined) {
    return `Unknown identity: ${identityName}.`;
  }

  const profile = identity.profiles[profileName];
  if (profile === undefined) {
    return `Unknown profile for ${identityName}: ${profileName}.`;
  }

  return { accountName: profile.keychainAccount };
}
