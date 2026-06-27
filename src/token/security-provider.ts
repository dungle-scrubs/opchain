import {
  createProviderEmptyTokenError,
  createProviderExitCodeError,
  createProviderOutputLimitError,
  createProviderStartError,
  createProviderTimeoutError,
  TokenMutationError,
  type TokenProviderResult,
} from "./token-provider.ts";
import { runTokenCommand } from "./command-backend.ts";

type SecurityTokenRequest = {
  readonly accountName: string;
  readonly securityPath: string;
  readonly serviceName: string;
};

type SetTokenWithSecurityRequest = {
  readonly accountName: string;
  readonly securityPath: string;
  readonly serviceName: string;
  readonly token: string;
};

type SetTokenResult =
  | { readonly ok: true }
  | { readonly error: TokenMutationError; readonly ok: false };

type RemoveTokenWithSecurityRequest = {
  readonly accountName: string;
  readonly securityPath: string;
  readonly serviceName: string;
};

type RemoveTokenResult =
  | { readonly ok: true }
  | { readonly error: TokenMutationError; readonly ok: false };

/**
 * Resolves a token from the Keychain via `security find-generic-password`.
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
    return { error: createProviderStartError("security"), ok: false };
  }
  if (!commandResult.ok && commandResult.error.reason === "timeout") {
    return { error: createProviderTimeoutError("security"), ok: false };
  }
  if (!commandResult.ok && commandResult.error.reason === "stdout_limit") {
    return { error: createProviderOutputLimitError("security"), ok: false };
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
    return { error: createProviderEmptyTokenError("security"), ok: false };
  }
  return { ok: true, value: token };
}

/**
 * Stores a token in the Keychain via `security add-generic-password`.
 *
 * The token is passed through `-w` on the command line. `/usr/bin/security`
 * does not offer a stdin-passed password mode for this subcommand.
 */
export async function setTokenWithSecurity(
  request: SetTokenWithSecurityRequest,
): Promise<SetTokenResult> {
  const commandResult = runTokenCommand(request.securityPath, [
    "add-generic-password",
    "-a",
    request.accountName,
    "-s",
    request.serviceName,
    "-w",
    request.token,
  ]);

  if (!commandResult.ok && commandResult.error.reason === "start") {
    return {
      error: new TokenMutationError("security token set failed to start."),
      ok: false,
    };
  }
  if (!commandResult.ok) {
    return {
      error: new TokenMutationError(
        `security token set failed with exit code ${commandResult.error.exitCode ?? 1}.`,
      ),
      ok: false,
    };
  }
  return { ok: true };
}

/**
 * Removes a token from the Keychain via `security delete-generic-password`.
 */
export async function removeTokenWithSecurity(
  request: RemoveTokenWithSecurityRequest,
): Promise<RemoveTokenResult> {
  const commandResult = runTokenCommand(request.securityPath, [
    "delete-generic-password",
    "-a",
    request.accountName,
    "-s",
    request.serviceName,
  ]);

  if (!commandResult.ok && commandResult.error.reason === "start") {
    return {
      error: new TokenMutationError("security token remove failed to start."),
      ok: false,
    };
  }
  if (!commandResult.ok) {
    return {
      error: new TokenMutationError(
        `security token remove failed with exit code ${commandResult.error.exitCode ?? 1}.`,
      ),
      ok: false,
    };
  }
  return { ok: true };
}

export type {
  RemoveTokenResult,
  RemoveTokenWithSecurityRequest,
  SecurityTokenRequest,
  SetTokenResult,
  SetTokenWithSecurityRequest,
};
