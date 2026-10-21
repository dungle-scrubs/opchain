/**
 * Isolated probe: the relay budget expiring during `op` setup, after the
 * token is resolved, is refused by the op child's own pre-spawn check.
 *
 * Time is controlled only at the system boundary. `Date.now` is frozen,
 * so config loading and the token provider spend no logical time, and
 * the timer-slack preload (`loosen-relay-timers.ts`) keeps every native
 * deadline timer from dispatching during that real time. The process
 * environment is a Proxy over an explicit synthetic environment: once
 * the fake `security` fixture's log exists - the provider has run - the
 * first read of `OPCHAIN_OP_PATH` advances the fake clock past the
 * deadline. The relay reads it while forming the op child's environment
 * and path, after its own post-token check and before the child's
 * pre-spawn check. The op path does not exist, so a missing pre-spawn
 * check surfaces as a spawn refusal instead of a timeout.
 *
 * Run only as its own Bun subprocess with the work directory as its
 * single argument. Prints one JSON line and exits.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  openSync,
} from "node:fs";
import { join } from "node:path";

import { runValueRelay } from "../../../src/op/relay-run.ts";
import { createCliOptions } from "../../helpers/create-cli-options.ts";
import { writeAutoReadWriteConfig } from "../../helpers/write-opchain-config.ts";

/** Logical relay budget, spent only by the fake clock's advance. */
const BUDGET_MS = 50;
const REFERENCE = "op://Infra/reflect-intake-restic/password";

/** The probe's single JSON report. */
export type RelaySetupExpiryReport = {
  readonly clockAdvanced: boolean;
  readonly exitCode: number;
  readonly providerRan: boolean;
  readonly stderr: string;
};

const workPath = process.argv[2] ?? "";
const configPath = writeAutoReadWriteConfig(workPath);
const securityLogPath = join(workPath, "security.log");
const fifoPath = join(workPath, "value.fifo");
spawnSync("/usr/bin/mkfifo", [fifoPath]);
const readFd = openSync(
  fifoPath,
  fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
);
const writeFd = openSync(fifoPath, fsConstants.O_WRONLY);

const synthetic: NodeJS.ProcessEnv = {
  HOME: workPath,
  OPCHAIN_CONFIG_PATH: configPath,
  OPCHAIN_OP_PATH: join(workPath, "nonexistent-op"),
  OPCHAIN_OP_TIMEOUT_MS: String(BUDGET_MS),
  OPCHAIN_SECURITY_PATH: join(process.cwd(), "test/fixtures/bin/security"),
  OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
  OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
  PATH: "/usr/bin:/bin",
};

const realDateNow = Date.now;
const realEnv = process.env;
let fakeNow = realDateNow();
let clockAdvanced = false;

try {
  Date.now = () => fakeNow;
  process.env = new Proxy(synthetic, {
    get(target, key, receiver) {
      if (
        key === "OPCHAIN_OP_PATH" &&
        !clockAdvanced &&
        existsSync(securityLogPath)
      ) {
        clockAdvanced = true;
        fakeNow += BUDGET_MS + 1_000;
      }
      return Reflect.get(target, key, receiver);
    },
  });

  const result = await runValueRelay({
    identityName: "primary",
    kind: "identity",
    options: createCliOptions({
      accessOverride: "read",
      commandArgs: ["primary", "op", "read", REFERENCE],
      valueFd: String(writeFd),
    }),
    trailingArgs: ["read", REFERENCE],
  });

  const outcome: RelaySetupExpiryReport = {
    clockAdvanced,
    exitCode: result.exitCode,
    providerRan: existsSync(securityLogPath),
    stderr: result.stderr,
  };
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} finally {
  process.env = realEnv;
  Date.now = realDateNow;
  closeSync(readFd);
  closeSync(writeFd);
}
process.exit(0);
