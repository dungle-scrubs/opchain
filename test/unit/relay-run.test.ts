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

import { runValueRelay } from "../../src/op/relay-run.ts";
import { commandFailure } from "../../src/cli/result.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";
import { withDelayedConfig } from "../helpers/delayed-config.ts";
import { withEnv } from "../helpers/with-env.ts";
import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");
const REFERENCE = "op://Infra/reflect-intake-restic/password";

/**
 * Creates one FIFO and reports both ends plus a cleanup handle.
 *
 * @returns {{ cleanup: () => void; writeFd: number }} FIFO write end for `--value-fd`.
 */
function createValueFifo(): {
  readonly cleanup: () => void;
  readonly writeFd: number;
} {
  const dir = mkdtempSync(join(tmpdir(), "opchain-relay-unit-fifo-"));
  const fifoPath = join(dir, "value.fifo");
  spawnSync("mkfifo", [fifoPath]);
  const readFd = openSync(
    fifoPath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  const writeFd = openSync(fifoPath, fsConstants.O_WRONLY);
  return {
    cleanup: () => {
      closeSync(readFd);
      closeSync(writeFd);
    },
    writeFd,
  };
}

/**
 * Drives one in-process relay run against the shared fixtures.
 *
 * @param env - Environment overrides for the run.
 * @returns {Promise<{ cleanup: () => void; result: Awaited<ReturnType<typeof runValueRelay>> }>} Relay result plus the FIFO handle.
 */
async function runRelayWithFifo(env: Record<string, string>): Promise<{
  readonly cleanup: () => void;
  readonly result: Awaited<ReturnType<typeof runValueRelay>>;
}> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-unit-"));
  const configPath = writeAutoReadWriteConfig(homePath);
  const fifo = createValueFifo();

  const result = await withEnv(
    {
      OPCHAIN_CONFIG_PATH: configPath,
      OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
      OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
      OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
      OPCHAIN_TEST_OP_LOG: join(homePath, "op.log"),
      OPCHAIN_TEST_SECURITY_TOKEN_LOG: join(homePath, "security.log"),
      ...env,
    },
    () =>
      runValueRelay({
        identityName: "primary",
        kind: "identity",
        options: createCliOptions({
          accessOverride: "read",
          commandArgs: ["primary", "op", "read", REFERENCE],
          valueFd: String(fifo.writeFd),
        }),
        trailingArgs: ["read", REFERENCE],
      }),
  );

  return { cleanup: fifo.cleanup, result };
}

describe("runValueRelay orchestration", () => {
  test("refuses a non-read path before touching config or tokens", async () => {
    const result = await runValueRelay({
      identityName: "primary",
      kind: "identity",
      options: createCliOptions({
        commandArgs: ["primary", "op", "vault", "list"],
        valueFd: "3",
      }),
      trailingArgs: ["vault", "list"],
    });

    expect(result).toEqual(commandFailure("opchain: relay: grammar\n"));
  });

  test("refuses a closed descriptor before config load", async () => {
    // A high descriptor is guaranteed closed regardless of what streams
    // the test runner itself holds open.
    const result = await runValueRelay({
      identityName: "primary",
      kind: "identity",
      options: createCliOptions({
        accessOverride: "read",
        commandArgs: ["primary", "op", "read", "op://V/I/f"],
        valueFd: "97",
      }),
      trailingArgs: ["read", "op://V/I/f"],
    });

    expect(result).toEqual(
      commandFailure("opchain: relay: descriptor-not-open\n"),
    );
  });

  test("an exhausted budget refuses before resolving a token", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-unit-"));
    const securityLogPath = join(homePath, "security.log");
    const opLogPath = join(homePath, "op.log");
    // Config arrives CONFIG_DELAY_MS after the read opens, so the 50 ms
    // budget is spent in config loading, before either subprocess.
    const { readerAttached, value: run } = await withDelayedConfig(
      (configPath) =>
        runRelayWithFifo({
          OPCHAIN_CONFIG_PATH: configPath,
          OPCHAIN_OP_TIMEOUT_MS: "50",
          OPCHAIN_TEST_OP_LOG: opLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
        }),
    );
    const { cleanup, result } = run;
    cleanup();

    expect(readerAttached).toBe(true);
    expect(result).toEqual(commandFailure("opchain: relay: deadline\n"));
    expect(existsSync(securityLogPath)).toBe(false);
    expect(existsSync(opLogPath)).toBe(false);
  }, 10_000);

  test("a stalled provider expires into the deadline without spawning op", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-unit-"));
    const opLogPath = join(homePath, "op.log");
    const startedAt = Date.now();
    const { cleanup, result } = await runRelayWithFifo({
      OPCHAIN_OP_TIMEOUT_MS: "800",
      OPCHAIN_TEST_SECURITY_SLEEP_MS: "30000",
      OPCHAIN_TEST_OP_SLEEP_MS: "30000",
      OPCHAIN_TEST_OP_LOG: opLogPath,
    });
    const elapsedMs = Date.now() - startedAt;
    cleanup();

    expect(result).toEqual(commandFailure("opchain: relay: deadline\n"));
    expect(elapsedMs).toBeLessThan(4_000);
    expect(existsSync(opLogPath)).toBe(false);
  }, 10_000);
});
