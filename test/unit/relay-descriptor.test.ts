import { describe, expect, test } from "bun:test";

import {
  evaluateRelayDescriptor,
  parseRelayFdNumber,
  type DescriptorFacts,
} from "../../src/op/relay-descriptor.ts";

const FIFO = 0o010000;
const SOCKET = 0o140000;
const CHARACTER_DEVICE = 0o020000;
const REGULAR_FILE = 0o100000;
const DIRECTORY = 0o040000;
const BLOCK_DEVICE = 0o060000;

function facts(type: number, dev = 1, ino = 100): DescriptorFacts {
  return { identity: { dev, ino }, type };
}

function statOf(table: Record<number, DescriptorFacts>) {
  return (fd: number): DescriptorFacts | undefined => table[fd];
}

describe("parseRelayFdNumber", () => {
  test("accepts non-negative decimal integers only", () => {
    expect(parseRelayFdNumber("3")).toBe(3);
    expect(parseRelayFdNumber("0")).toBe(0);
    expect(parseRelayFdNumber("007")).toBe(7);
    expect(parseRelayFdNumber("abc")).toBeNull();
    expect(parseRelayFdNumber("3.5")).toBeNull();
    expect(parseRelayFdNumber("+3")).toBeNull();
    expect(parseRelayFdNumber("-1")).toBeNull();
    expect(parseRelayFdNumber("")).toBeNull();
    expect(parseRelayFdNumber("999999999999999999999")).toBeNull();
  });
});

describe("evaluateRelayDescriptor", () => {
  test("accepts a genuinely separate pipe or socket endpoint", () => {
    const table = {
      1: facts(FIFO, 1, 1),
      2: facts(FIFO, 1, 2),
      3: facts(FIFO, 1, 3),
    };

    expect(evaluateRelayDescriptor(3, statOf(table))).toBeNull();
    expect(
      evaluateRelayDescriptor(4, statOf({ ...table, 4: facts(SOCKET, 2, 9) })),
    ).toBeNull();
  });

  test("refuses an fd that is not open", () => {
    expect(
      evaluateRelayDescriptor(3, statOf({ 1: facts(FIFO), 2: facts(FIFO) })),
    ).toBe("descriptor-not-open");
  });

  test("refuses descriptors 0, 1 and 2", () => {
    const table = {
      0: facts(FIFO, 1, 0),
      1: facts(FIFO, 1, 1),
      2: facts(FIFO, 1, 2),
    };

    expect(evaluateRelayDescriptor(0, statOf(table))).toBe(
      "descriptor-standard",
    );
    expect(evaluateRelayDescriptor(1, statOf(table))).toBe(
      "descriptor-standard",
    );
    expect(evaluateRelayDescriptor(2, statOf(table))).toBe(
      "descriptor-standard",
    );
  });

  test("refuses a TTY, regular file, directory, and block device", () => {
    for (const type of [
      CHARACTER_DEVICE,
      REGULAR_FILE,
      DIRECTORY,
      BLOCK_DEVICE,
    ]) {
      const table = {
        1: facts(FIFO, 1, 1),
        2: facts(FIFO, 1, 2),
        3: facts(type, 1, 3),
      };

      expect(evaluateRelayDescriptor(3, statOf(table))).toBe(
        "descriptor-not-pipe",
      );
    }
  });

  test("refuses a duplicated pipe endpoint aliasing stdout or stderr", () => {
    // fd 3 names the same underlying endpoint as fd 1 (piped stdout).
    const aliasStdout = {
      1: facts(FIFO, 7, 42),
      2: facts(FIFO, 1, 2),
      3: facts(FIFO, 7, 42),
    };
    expect(evaluateRelayDescriptor(3, statOf(aliasStdout))).toBe(
      "descriptor-alias",
    );

    // fd 3 names the same underlying endpoint as fd 2 (piped stderr).
    const aliasStderr = {
      1: facts(FIFO, 1, 1),
      2: facts(FIFO, 9, 99),
      3: facts(FIFO, 9, 99),
    };
    expect(evaluateRelayDescriptor(3, statOf(aliasStderr))).toBe(
      "descriptor-alias",
    );
  });

  test("allows a duplicated unrelated pipe while stdout is a different pipe", () => {
    const table = {
      1: facts(FIFO, 1, 1),
      2: facts(FIFO, 1, 2),
      3: facts(FIFO, 5, 55),
    };

    expect(evaluateRelayDescriptor(3, statOf(table))).toBeNull();
  });

  test("runs the alias check only on pipe or socket descriptors, in order", () => {
    // A regular file that shares stdout's identity numbers is refused by
    // the type check before the alias check runs.
    const regularAliasingStdout = {
      1: facts(REGULAR_FILE, 7, 42),
      2: facts(FIFO, 1, 2),
      3: facts(REGULAR_FILE, 7, 42),
    };
    expect(evaluateRelayDescriptor(3, statOf(regularAliasingStdout))).toBe(
      "descriptor-not-pipe",
    );
  });

  test("skips a closed stdout or stderr endpoint in the alias comparison", () => {
    const table = { 3: facts(FIFO, 1, 1) };

    expect(evaluateRelayDescriptor(3, statOf(table))).toBeNull();
  });
});
