import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  openSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRelay } from "../helpers/run-relay.ts";

const SYNTHETIC_VALUE = "synthetic-relay-value-61";
const REFERENCE = "op://Infra/reflect-intake-restic/password";
const DENIED_STDERR =
  'vault "Infra" isn\'t in this account or you don\'t have access to it';

type TelemetryEvent = {
  readonly attributes: Record<string, unknown>;
  readonly name: string;
};

/**
 * Parses newline-delimited JSON telemetry from mixed stderr text.
 *
 * @param stderr - Raw stderr that may mix failure lines and telemetry.
 * @returns {readonly TelemetryEvent[]} Parsed telemetry events.
 */
function parseTelemetryEvents(stderr: string): readonly TelemetryEvent[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("op --value-fd failure paths", () => {
  test("child failure writes nothing and prints only the classified identifier", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_TEST_OP_READ_STDERR: DENIED_STDERR,
          OPCHAIN_TEST_OP_READ_EXIT_CODE: "3",
        },
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-failed:denied\n");
    expect(run.valueBytes.length).toBe(0);
    expect(run.stderrText).not.toContain("Infra");
    expect(run.stderrText).not.toContain("account");
  });

  test("classifies notfound, unreachable, and unknown diagnostics", async () => {
    const cases: readonly [string, string][] = [
      [
        '"op://Infra/reflect-intake-restic/password" isn\'t a field in the item',
        "child-failed:notfound",
      ],
      ["POST: dial tcp: i/o timeout", "child-failed:unreachable"],
      ["dial tcp: lookup example.com: no such host", "child-failed:unreachable"],
      ["something unexpected", "child-failed:unknown"],
    ];

    for (const [diagnostic, identifier] of cases) {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        {
          env: {
            OPCHAIN_TEST_OP_READ_STDERR: diagnostic,
            OPCHAIN_TEST_OP_READ_EXIT_CODE: "1",
          },
        },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe(`opchain: relay: ${identifier}\n`);
      expect(run.valueBytes.length).toBe(0);
    }
  }, 30_000);

  test("child timeout reports child-timeout and writes nothing", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: "3000",
          OPCHAIN_TEST_OP_SLEEP_MS: "30000",
        },
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-timeout\n");
    expect(run.valueBytes.length).toBe(0);
  }, 10_000);

  test("a descendant holding the pipes settles the deadline after its parent exits", async () => {
    const startedAt = Date.now();
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: "1500",
          OPCHAIN_TEST_OP_LEAVE_DESCENDANT: "1",
        },
      },
    );
    const elapsedMs = Date.now() - startedAt;

    // The child exited at once; its descendant keeps the pipe open, so
    // only deadline expiry can settle the relay - with the child-timeout
    // identifier (the deadline expired in the child phase), never a hang
    // and never a signal to the reaped child.
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-timeout\n");
    expect(elapsedMs).toBeGreaterThanOrEqual(1_400);
    expect(elapsedMs).toBeLessThan(15_000);
  }, 25_000);

  test("an expired budget refuses before starting either subprocess", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      { env: { OPCHAIN_OP_TIMEOUT_MS: "1" } },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    // The provider never started: a zero budget refuses, it never
    // launches a subprocess (and never means unlimited execution).
    expect(existsSync(run.securityLogPath)).toBe(false);
    expect(existsSync(run.opLogPath)).toBe(false);
  }, 20_000);

  test("a stalled token resolution hits the deadline, proving cancellable plumbing", async () => {
    const startedAt = Date.now();
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: "1500",
          OPCHAIN_TEST_SECURITY_SLEEP_MS: "30000",
          OPCHAIN_TEST_OP_SLEEP_MS: "30000",
        },
      },
    );
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(15_000);
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    expect(run.valueBytes.length).toBe(0);
  }, 15_000);

  test("a stalled peer polls until the deadline and never sees a spurious failure", async () => {
    const startedAt = Date.now();
    const run = await runRelay(
      ["primary", "--read", "--value-fd=3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: "5000",
          OPCHAIN_TEST_OP_RELAY_VALUE_BYTES: "262144",
        },
        peerMode: "stall-after-first-chunk",
      },
    );
    const elapsedMs = Date.now() - startedAt;

    // The non-blocking write loop polls while the pipe is full: a
    // stalled (not closed) peer is never a write error, the loop waits
    // out the whole deadline, and a prefix was already delivered.
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    expect(elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(elapsedMs).toBeLessThan(15_000);
    expect(run.valueBytes.length).toBeGreaterThan(0);
    expect(run.valueBytes.length).toBeLessThan(262_145);
  }, 25_000);

  test("an explicitly blocking inherited pipe with a silent peer ends at the deadline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opchain-relay-fifo-"));
    const fifoPath = join(dir, "value.fifo");
    spawnSync("mkfifo", [fifoPath]);

    // The read end is held open and never read; the write end is passed
    // as the inherited descriptor - a genuinely blocking FIFO, not a
    // Bun-created pipe socket.
    const readFd = openSync(fifoPath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const writeFd = openSync(fifoPath, fsConstants.O_WRONLY);
    const startedAt = Date.now();

    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: "3000",
          OPCHAIN_TEST_OP_RELAY_VALUE_BYTES: "262144",
        },
        stdio3: { kind: "raw-fd", fd: writeFd },
      },
    );
    const elapsedMs = Date.now() - startedAt;
    closeSync(readFd);
    closeSync(writeFd);

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    expect(elapsedMs).toBeGreaterThanOrEqual(2_800);
    expect(elapsedMs).toBeLessThan(15_000);
  }, 25_000);

  test("a child that writes the value before a nonzero exit delivers nothing", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_TEST_OP_RELAY_LEAK_STDOUT: SYNTHETIC_VALUE,
        },
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-failed:unknown\n");
    expect(run.valueBytes.length).toBe(0);
    expect(run.stdoutText).toBe("");
    expect(run.stderrText).not.toContain(SYNTHETIC_VALUE);
  });

  test("a peer that closes mid-value gets write-failed after a prefix", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd=3", "op", "read", REFERENCE],
      {
        env: { OPCHAIN_TEST_OP_RELAY_VALUE_BYTES: "262144" },
        peerMode: "destroy-after-first-chunk",
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: write-failed\n");
    expect(run.valueBytes.length).toBeGreaterThan(0);
    expect(run.valueBytes.length).toBeLessThan(262_145);
  }, 15_000);

  test("a stalled config load hits the overall deadline", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-cfg-"));
    const fifoPath = join(homePath, "config.fifo");
    spawnSync("mkfifo", [fifoPath]);

    const startedAt = Date.now();
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_CONFIG_PATH: fifoPath,
          OPCHAIN_OP_TIMEOUT_MS: "1500",
        },
      },
    );
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(15_000);
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
  }, 20_000);

  test("an unknown identity reports config without running op", async () => {
    const run = await runRelay([
      "not-an-identity",
      "--read",
      "--value-fd",
      "3",
      "op",
      "read",
      REFERENCE,
    ]);

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: config\n");
  });

  test("an unreadable token reports token", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_TEST_SECURITY_EXIT_CODE: "1",
          OPCHAIN_TEST_SECURITY_STDERR: "could not read keychain",
        },
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: token\n");
    expect(run.stderrText).not.toContain("keychain");
  });

  test("a missing op binary reports spawn", async () => {
    const run = await runRelay(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      { env: { OPCHAIN_OP_PATH: "/nonexistent-opchain-op" } },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: spawn\n");
  });

  test("telemetry carries byte counts and the outcome enum only", async () => {
    const run = await runRelay(
      [
        "--debug",
        "--debug-format",
        "json",
        "primary",
        "--read",
        "--value-fd",
        "3",
        "op",
        "read",
        REFERENCE,
      ],
      { env: { OPCHAIN_TEST_OP_RELAY_VALUE: SYNTHETIC_VALUE } },
    );

    expect(run.result).toEqual({ code: 0, signal: null });

    const relayEvent = parseTelemetryEvents(run.stderrText).find(
      (event) => event.name === "op.reveal.fd_relay",
    );

    expect(relayEvent?.attributes).toEqual({
      form: "read",
      identity: "primary",
      outcome: "written",
      value_bytes: SYNTHETIC_VALUE.length + 1,
    });
    expect(run.stderrText).not.toContain(SYNTHETIC_VALUE);
  });

  test("telemetry records refused descriptor outcomes", async () => {
    const run = await runRelay([
      "--debug",
      "--debug-format",
      "json",
      "primary",
      "--read",
      "--value-fd",
      "1",
      "op",
      "read",
      REFERENCE,
    ]);

    expect(run.result).toEqual({ code: 1, signal: null });

    const relayEvent = parseTelemetryEvents(run.stderrText).find(
      (event) => event.name === "op.reveal.fd_relay",
    );

    expect(relayEvent?.attributes).toEqual({
      form: "read",
      identity: "primary",
      outcome: "refused:descriptor-standard",
      value_bytes: 0,
    });
  });

  test("debug metadata rides a separately prefixed line that never matches the anchor", async () => {
    const run = await runRelay(
      [
        "--debug",
        "primary",
        "--read",
        "--value-fd",
        "1",
        "op",
        "read",
        REFERENCE,
      ],
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toContain("opchain: relay: descriptor-standard\n");
    expect(run.stderrText).toMatch(/^opchain debug: relay: .*$/m);
    const anchoredLines = run.stderrText
      .split("\n")
      .filter((line) => /^opchain: relay: [a-z-]+(:[a-z-]+)?$/.test(line));
    expect(anchoredLines).toEqual(["opchain: relay: descriptor-standard"]);
  });
});
