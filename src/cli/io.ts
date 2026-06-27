import { existsSync, readFileSync } from "node:fs";

import {
  loadExpiryStateOrEmpty,
  saveExpiryState,
  type ExpiryState,
} from "../expires/state.ts";

export type ExpiryStateResult =
  | { readonly ok: true; readonly value: ExpiryState }
  | { readonly error: string; readonly ok: false };

export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly error: string; readonly ok: false };

export type TextReadResult =
  | { readonly ok: true; readonly value: string }
  | { readonly error: string; readonly ok: false };

/**
 * Formats one unknown runtime error for CLI output.
 *
 * @param prefix - Stable message prefix.
 * @param error - Unknown thrown value.
 * @returns {string} Printable error message.
 */
export function formatRuntimeError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }

  return `${prefix}.`;
}

/**
 * Checks whether an executable is available directly or through PATH.
 *
 * @param executablePath - Configured executable path or command name.
 * @returns {boolean} True when the executable can be resolved.
 */
export function isExecutableAvailable(executablePath: string): boolean {
  if (executablePath.includes("/")) {
    return existsSync(executablePath);
  }

  return typeof Bun.which(executablePath) === "string";
}

/**
 * Loads one expiry state file with CLI-friendly errors.
 *
 * @param statePath - Expiry state file path.
 * @param identityName - Identity name used for empty-state fallback.
 * @returns {ExpiryStateResult} Loaded state or a printable error.
 */
export function loadExpiryStateResult(
  statePath: string,
  identityName: string,
): ExpiryStateResult {
  try {
    return {
      ok: true,
      value: loadExpiryStateOrEmpty(statePath, identityName),
    };
  } catch (error) {
    return {
      error: formatRuntimeError("Failed to load expiry state", error),
      ok: false,
    };
  }
}

/**
 * Parses one JSON payload with a stable invalid-payload message.
 *
 * @param jsonText - Raw JSON text.
 * @param invalidPayloadMessage - Message returned when parsing fails.
 * @returns {JsonParseResult} Parsed value or a printable error.
 */
export function parseJsonText(
  jsonText: string,
  invalidPayloadMessage: string,
): JsonParseResult {
  try {
    return {
      ok: true,
      value: JSON.parse(jsonText) as unknown,
    };
  } catch {
    return {
      error: invalidPayloadMessage,
      ok: false,
    };
  }
}

/**
 * Reads exactly one token value from stdin.
 *
 * @returns {string | null} Token string or null when stdin is invalid.
 */
export function readTokenFromStdin(): string | null {
  const rawInput = readFileSync(0, "utf8");
  const token = rawInput.replace(/\r?\n$/, "");

  if (token.length === 0 || token.includes("\n") || token.includes("\r")) {
    return null;
  }

  return token;
}

/**
 * Reads one UTF-8 text file with CLI-friendly errors.
 *
 * @param filePath - File path to read.
 * @param errorPrefix - Stable message prefix for failures.
 * @returns {TextReadResult} File content or a printable error.
 */
export function readTextFile(
  filePath: string,
  errorPrefix: string,
): TextReadResult {
  try {
    return {
      ok: true,
      value: readFileSync(filePath, "utf8"),
    };
  } catch (error) {
    return {
      error: formatRuntimeError(errorPrefix, error),
      ok: false,
    };
  }
}

/**
 * Saves one expiry state file with CLI-friendly errors.
 *
 * @param statePath - Expiry state file path.
 * @param state - Serializable expiry state.
 * @returns {string | null} Printable error or null on success.
 */
export function saveExpiryStateResult(
  statePath: string,
  state: ExpiryState,
): string | null {
  try {
    saveExpiryState(statePath, state);
    return null;
  } catch (error) {
    return formatRuntimeError("Failed to save expiry state", error);
  }
}
