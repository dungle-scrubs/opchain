import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";
import {
  RELAY_OP_FIXTURE_PATH as OP_FIXTURE_PATH,
  RELAY_SECURITY_FIXTURE_PATH as SECURITY_FIXTURE_PATH,
  runRelay,
} from "../helpers/run-relay.ts";

const SYNTHETIC_VALUE = "synthetic-relay-value-61";
const REFERENCE = "op://Infra/reflect-intake-restic/password";

describe("op --value-fd relay", () => {
  describe("parser refusals render anchored relay identifiers", () => {
    test("forbidden --read with --write combination gives grammar", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "--write",
        "--value-fd",
        "3",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: grammar\n");
      expect(existsSync(run.opLogPath)).toBe(false);
    });

    test("missing descriptor value gives descriptor-not-open", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "--value-fd",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-open\n");
      expect(existsSync(run.opLogPath)).toBe(false);
    });

    test("negative descriptor value gives descriptor-not-open", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "--value-fd",
        "-1",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-open\n");
    });

    test("another flag's missing value gives grammar", async () => {
      const run = await runRelay([
        "primary",
        "--value-fd",
        "3",
        "--profile",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: grammar\n");
    });
  });

  describe("argument passthrough without relay mode", () => {
    test("delivers wrapped-program arguments after op byte for byte", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "op",
        "run",
        "--",
        "/bin/echo",
        "--value-fd=3",
        "--out-file=x",
      ], { env: { OPCHAIN_TEST_OP_RUN_EXEC: "1" } });

      expect(run.result).toEqual({ code: 0, signal: null });
      expect(run.stdoutText).toContain("--value-fd=3 --out-file=x");
      expect(readFileSync(run.opLogPath, "utf8")).toContain(
        "--value-fd=3 --out-file=x",
      );
      expect(run.stdoutText).not.toContain("--value-fd 3");
    });
  });
  describe("successful relay", () => {
    test("delivers the value byte-exact on descriptor 3 with empty stdout and stderr", async () => {
      const run = await runRelay(
        [
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
      expect(run.valueBytes.toString("utf8")).toBe(`${SYNTHETIC_VALUE}\n`);
      expect(run.stdoutText).toBe("");
      expect(run.stderrText).toBe("");
    });

    test("delivers a value larger than the pipe buffer byte-exact", async () => {
      const totalBytes = 262_145; // 256 KiB of x plus trailing newline
      const run = await runRelay(
        [
          "primary",
          "--read",
          "--value-fd=3",
          "op",
          "read",
          REFERENCE,
        ],
        { env: { OPCHAIN_TEST_OP_RELAY_VALUE_BYTES: "262144" } },
      );

      const value = run.valueBytes;
      expect(run.result).toEqual({ code: 0, signal: null });
      expect(value.length).toBe(totalBytes);
      expect(value.subarray(0, totalBytes - 1).equals(Buffer.alloc(totalBytes - 1, 0x78))).toBe(
        true,
      );
      expect(value.subarray(totalBytes - 1).toString("utf8")).toBe("\n");
      expect(run.stdoutText).toBe("");
      expect(run.stderrText).toBe("");
    });

    test("runs the op child with the reference and the read-profile token", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        { env: { OPCHAIN_TEST_OP_RELAY_VALUE: SYNTHETIC_VALUE } },
      );

      expect(run.result).toEqual({ code: 0, signal: null });
      expect(readFileSync(run.opLogPath, "utf8")).toBe(
        `args=read ${REFERENCE}\ntoken=token-for-primary-read\n`,
      );
      expect(readFileSync(run.securityLogPath, "utf8")).toBe(
        "service=opchain\naccount=opchain:primary:read\n",
      );
    });

    test("relays a successful read even when op prints a sensitive warning on stderr", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        {
          env: {
            OPCHAIN_TEST_OP_RELAY_VALUE: SYNTHETIC_VALUE,
            OPCHAIN_TEST_OP_RELAY_WARN_STDERR:
              "sensitive-warning-do-not-print",
          },
        },
      );

      expect(run.result).toEqual({ code: 0, signal: null });
      expect(run.valueBytes.toString("utf8")).toBe(`${SYNTHETIC_VALUE}\n`);
      expect(run.stderrText).toBe("");
      expect(run.stderrText).not.toContain("sensitive-warning-do-not-print");
    });
  });

  describe("grammar refusals", () => {
    test("refuses every out-file spelling before spawn", async () => {
      const spellings: readonly (readonly string[])[] = [
        ["read", "-o", "out.txt", REFERENCE],
        ["read", "-oout.txt", REFERENCE],
        ["read", "-o=out.txt", REFERENCE],
        ["read", "--out-file", "out.txt", REFERENCE],
        ["read", "--out-file=out.txt", REFERENCE],
        ["read", REFERENCE, "-o", "out.txt"],
      ];

      for (const opArgs of spellings) {
        const outFile = join(
          mkdtempSync(join(tmpdir(), "opchain-relay-gram-")),
          "out.txt",
        );
        const run = await runRelay([
          "primary",
          "--read",
          "--value-fd",
          "3",
          "op",
          ...opArgs,
        ]);

        expect(run.result).toEqual({ code: 1, signal: null });
        expect(run.stderrText).toBe("opchain: relay: grammar\n");
        expect(existsSync(run.opLogPath)).toBe(false);
        expect(existsSync(run.securityLogPath)).toBe(false);
        expect(existsSync(outFile)).toBe(false);
      }
    });

    test("refuses global flags, -- separators, extra references, and non-read paths", async () => {
      const refused: readonly (readonly string[])[] = [
        ["read", "--account", "acme", REFERENCE],
        ["read", "--format=json", REFERENCE],
        ["read", "--", REFERENCE],
        ["read"],
        ["read", REFERENCE, REFERENCE],
        ["read", "get"],
        ["vault", "list"],
        ["read", "not-a-reference"],
      ];

      for (const opArgs of refused) {
        const run = await runRelay([
          "primary",
          "--read",
          "--value-fd",
          "3",
          "op",
          ...opArgs,
        ]);

        expect(run.result).toEqual({ code: 1, signal: null });
        expect(run.stderrText).toBe("opchain: relay: grammar\n");
        expect(existsSync(run.opLogPath)).toBe(false);
        expect(existsSync(run.securityLogPath)).toBe(false);
      }
    });

    test("refuses --allow-reveal alongside --value-fd with precedence over the interactive override", () => {
      const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-tty-"));
      writeAutoReadWriteConfig(homePath);
      const opLogPath = join(homePath, "op.log");

      const expectScript = [
        "log_user 1",
        "set timeout 15",
        "spawn sh -c \"exec $env(BUN_BIN) run src/index.ts primary --read --allow-reveal --value-fd 3 op read op://Infra/reflect-intake-restic/password\"",
        "expect eof",
        'lassign [wait] pid spawnid os_error_flag status',
        "exit $status",
      ].join("\n");

      const result = spawnSync("expect", ["-c", expectScript], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BIN: process.execPath,
          HOME: homePath,
          OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
          OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
          OPCHAIN_TEST_OP_LOG: opLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        },
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("opchain: relay: grammar");
      expect(existsSync(opLogPath)).toBe(false);
    });

    test("refuses --pass-token alongside --value-fd", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "--value-fd",
        "3",
        "--pass-token",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: grammar\n");
    });

    test("refuses a missing --read flag", async () => {
      const run = await runRelay([
        "primary",
        "--value-fd",
        "3",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: grammar\n");
    });

    test("refuses a non-integer descriptor number as descriptor-not-open", async () => {
      const run = await runRelay([
        "primary",
        "--read",
        "--value-fd=abc",
        "op",
        "read",
        REFERENCE,
      ]);

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-open\n");
      expect(existsSync(run.opLogPath)).toBe(false);
    });
  });

  describe("descriptor checks", () => {
    test("refuses a closed descriptor before spawn", async () => {
      // Bun keeps an internal FIFO at its own fd 3, so the closed case
      // probes a high descriptor that is guaranteed not to be open.
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "97", "op", "read", REFERENCE],
        { stdio3: { kind: "closed" } },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-open\n");
      expect(existsSync(run.opLogPath)).toBe(false);
      expect(existsSync(run.securityLogPath)).toBe(false);
    });

    test("refuses descriptors 0, 1, and 2", async () => {
      for (const n of ["1", "2"]) {
        const run = await runRelay(
          ["primary", "--read", "--value-fd", n, "op", "read", REFERENCE],
          { stdio3: { kind: "pipe" } },
        );

        expect(run.result).toEqual({ code: 1, signal: null });
        expect(run.stderrText).toBe("opchain: relay: descriptor-standard\n");
        expect(existsSync(run.opLogPath)).toBe(false);
      }
    });

    test("refuses a descriptor duplicating a piped stdout endpoint", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        { stdio3: { kind: "duplicate-of", fd: 1 } },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-alias\n");
      expect(run.stdoutText).toBe("");
      expect(run.valueBytes.length).toBe(0);
      expect(existsSync(run.opLogPath)).toBe(false);
    });

    test("refuses a descriptor duplicating a piped stderr endpoint", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        { stdio3: { kind: "duplicate-of", fd: 2 } },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-alias\n");
      expect(run.valueBytes.length).toBe(0);
    });

    test("allows a separate pipe while stdout is a different pipe", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        {
          env: { OPCHAIN_TEST_OP_RELAY_VALUE: SYNTHETIC_VALUE },
          stdio3: { kind: "pipe" },
        },
      );

      expect(run.result).toEqual({ code: 0, signal: null });
      expect(run.valueBytes.toString("utf8")).toBe(`${SYNTHETIC_VALUE}\n`);
      expect(run.stdoutText).toBe("");
    });

    test("refuses a regular file and leaves it untouched", async () => {
      const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-file-"));
      const targetPath = join(homePath, "value-target.txt");

      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        { stdio3: { kind: "file-path", path: targetPath } },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-pipe\n");
      expect(statSync(targetPath).size).toBe(0);
    });

    test("refuses /dev/null", async () => {
      const run = await runRelay(
        ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
        { stdio3: { kind: "file-path", path: "/dev/null" } },
      );

      expect(run.result).toEqual({ code: 1, signal: null });
      expect(run.stderrText).toBe("opchain: relay: descriptor-not-pipe\n");
    });

    test("refuses a TTY descriptor", () => {
      const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-tty3-"));
      writeAutoReadWriteConfig(homePath);

      const expectScript = [
        "log_user 1",
        "set timeout 15",
        "spawn sh -c \"exec $env(BUN_BIN) run src/index.ts primary --read --value-fd 3 op read op://Infra/reflect-intake-restic/password 3>&1\"",
        "expect eof",
        'lassign [wait] pid spawnid os_error_flag status',
        "exit $status",
      ].join("\n");

      const result = spawnSync("expect", ["-c", expectScript], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BIN: process.execPath,
          HOME: homePath,
          OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
          OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        },
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("opchain: relay: descriptor-not-pipe");
    });
  });
});
