import { constants as fsConstants, fstatSync } from "node:fs";

import type { RelayCheck } from "./relay.ts";

/** One descriptor's fstat facts: type bits plus endpoint identity. */
export type DescriptorFacts = {
  /** Device/inode pair naming the underlying endpoint on macOS. */
  readonly identity: { readonly dev: number; readonly ino: number };
  /** `st_mode & S_IFMT` type bits. */
  readonly type: number;
};

/** Largest fd number accepted; avoids overflow into invalid descriptors. */
const MAX_FD_NUMBER = 1_000_000;

/**
 * Parses the `--value-fd` value as a decimal integer >= 0.
 *
 * Any other spelling fails closed; the caller reports
 * `descriptor-not-open` per the descriptor checks.
 *
 * @param value - Raw flag value.
 * @returns {number | null} Parsed descriptor number, or null when invalid.
 */
export function parseRelayFdNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed <= MAX_FD_NUMBER ? parsed : null;
}

/**
 * Reads one descriptor's fstat facts, or undefined when it is not open.
 *
 * @param fd - Descriptor number.
 * @returns {DescriptorFacts | undefined} Facts, or undefined when fstat fails.
 */
function liveStatOf(fd: number): DescriptorFacts | undefined {
  try {
    const stats = fstatSync(fd);
    return {
      identity: { dev: stats.dev, ino: stats.ino },
      type: stats.mode & fsConstants.S_IFMT,
    };
  } catch {
    return undefined;
  }
}

/**
 * Evaluates the fail-closed descriptor checks, in order.
 *
 * 1. The fd parses and is open (`descriptor-not-open`).
 * 2. The fd is greater than 2 (`descriptor-standard`).
 * 3. The fd is a FIFO (pipe) or socket (`descriptor-not-pipe`).
 * 4. The fd does not alias stdout's or stderr's endpoint
 *    (`descriptor-alias`), compared by `st_dev`/`st_ino` identity, which
 *    on macOS names the same underlying pipe or socket endpoint for
 *    duplicated descriptors. A closed fd 1 or fd 2 is skipped.
 *
 * @param fd - Parsed descriptor number.
 * @param statOf - Injectable fstat lookup returning undefined when not open.
 * @returns {RelayCheck | null} The first failing check, or null when accepted.
 */
export function evaluateRelayDescriptor(
  fd: number,
  statOf: (fd: number) => DescriptorFacts | undefined = liveStatOf,
): RelayCheck | null {
  const descriptor = statOf(fd);
  if (descriptor === undefined) {
    return "descriptor-not-open";
  }

  if (fd <= 2) {
    return "descriptor-standard";
  }

  const typeIsPipeOrSocket =
    descriptor.type === fsConstants.S_IFIFO ||
    descriptor.type === fsConstants.S_IFSOCK;
  if (!typeIsPipeOrSocket) {
    return "descriptor-not-pipe";
  }

  for (const standardFd of [1, 2]) {
    const endpoint = statOf(standardFd);
    if (
      endpoint !== undefined &&
      endpoint.identity.dev === descriptor.identity.dev &&
      endpoint.identity.ino === descriptor.identity.ino
    ) {
      return "descriptor-alias";
    }
  }

  return null;
}
