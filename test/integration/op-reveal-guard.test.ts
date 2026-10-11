import { describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");

type OpchainRun = {
  readonly homePath: string;
  readonly opLogPath: string;
  readonly result: SpawnSyncReturns<string>;
  readonly securityLogPath: string;
};

/**
 * Runs one opchain `op` invocation against the fixture binaries.
 *
 * @param argv - Arguments after `bun run src/index.ts`.
 * @param envOverrides - Extra environment variables for the child.
 * @returns {OpchainRun} Spawn result plus fixture log paths.
 */
function runOpchainOp(
  argv: readonly string[],
  envOverrides: Record<string, string> = {},
): OpchainRun {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-reveal-"));
  writeAutoReadWriteConfig(homePath);
  const opLogPath = join(homePath, "op.log");
  const securityLogPath = join(homePath, "security.log");

  const result = spawnSync(process.execPath, ["run", "src/index.ts", ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homePath,
      OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
      OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
      OPCHAIN_TEST_OP_LOG: opLogPath,
      OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
      OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
      ...envOverrides,
    },
  });

  return { homePath, opLogPath, result, securityLogPath };
}

/**
 * Asserts one refused reveal form end to end.
 *
 * @param argv - Full opchain argv.
 * @param expectedStderr - Stderr fragment required in the refusal.
 */
function expectRefused(argv: readonly string[], expectedStderr: string): void {
  const { opLogPath, result, securityLogPath } = runOpchainOp(argv);

  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(expectedStderr);
  expect(result.stderr).toContain(
    "To run it anyway from an interactive terminal, pass --allow-reveal before `op`.",
  );
  expect(existsSync(opLogPath)).toBe(false);
  expect(existsSync(securityLogPath)).toBe(false);
}

/**
 * Parses newline-delimited JSON telemetry events from mixed stderr text.
 *
 * @param stderr - Raw stderr that may mix refusal text and telemetry lines.
 * @returns Parsed telemetry events.
 */
function parseTelemetryEvents(
  stderr: string,
): readonly { attributes: Record<string, unknown>; name: string }[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          attributes: Record<string, unknown>;
          name: string;
        },
    );
}

type RefusalFormRow = {
  readonly form: string;
  readonly opArgs: readonly string[];
  readonly profileFlag: string;
};

const REFUSAL_FORM_ROWS: readonly RefusalFormRow[] = [
  {
    form: "read-stdout",
    opArgs: ["read", "op://SentinelVault/SentinelItem/field"],
    profileFlag: "--read",
  },
  {
    form: "inject-stdout",
    opArgs: ["inject", "-i", "template.tpl"],
    profileFlag: "--read",
  },
  {
    form: "document-get-stdout",
    opArgs: ["document", "get", "SentinelDoc"],
    profileFlag: "--read",
  },
  {
    form: "item-get-reveal",
    opArgs: ["item", "get", "SentinelItem", "--reveal"],
    profileFlag: "--read",
  },
  {
    form: "item-get-reveal",
    opArgs: ["item", "get", "SentinelItem", "--otp"],
    profileFlag: "--read",
  },
  {
    form: "item-get-reveal",
    opArgs: ["item", "get", "SentinelItem", "--format", "json"],
    profileFlag: "--read",
  },
  {
    form: "item-write-reveal",
    opArgs: ["item", "create", "--title", "SentinelItem", "--reveal"],
    profileFlag: "--write",
  },
  {
    form: "item-write-reveal",
    opArgs: ["item", "edit", "SentinelItem", "--format", "json"],
    profileFlag: "--write",
  },
  {
    form: "run-no-masking",
    opArgs: ["run", "--no-masking", "--", "printenv"],
    profileFlag: "--read",
  },
  {
    form: "signin",
    opArgs: ["signin", "--raw"],
    profileFlag: "--read",
  },
  {
    form: "token-create",
    opArgs: ["service-account", "create", "SentinelSA"],
    profileFlag: "--write",
  },
  {
    form: "token-create",
    opArgs: ["connect", "token", "create", "SentinelToken"],
    profileFlag: "--write",
  },
  {
    form: "token-create",
    opArgs: ["events-api", "create", "SentinelEvents"],
    profileFlag: "--write",
  },
  {
    form: "unclassifiable-order",
    opArgs: ["item", "--vault", "SentinelVault", "get", "SentinelItem"],
    profileFlag: "--read",
  },
];

/**
 * Labels one table row for test names.
 *
 * @param row - Refusal form row.
 * @returns {string} Human-readable row label.
 */
function rowLabel(row: RefusalFormRow): string {
  return `${row.form}: op ${row.opArgs.join(" ")}`;
}

/**
 * Builds the expected refusal headline for one form.
 *
 * @param form - Stable form id.
 * @returns {string} Refusal headline.
 */
function refusalHeadline(form: string): string {
  return form === "unclassifiable-order"
    ? "Refused: opchain cannot tell whether this op command prints secret values."
    : `Refused: this op command prints secret values (${form}).`;
}

/**
 * Asserts no whitespace-separated stderr token leaks a Sentinel argument value.
 *
 * @param stderr - Raw stderr output.
 * @returns {void} Nothing.
 */
function expectNoSentinelValue(stderr: string): void {
  for (const token of stderr.split(/\s+/)) {
    expect(token.startsWith("Sentinel")).toBe(false);
  }
}

describe("op reveal guard", () => {
  describe("refused forms", () => {
    test("refuses op read to stdout", () => {
      const { result } = runOpchainOp([
        "primary",
        "op",
        "read",
        "op://SentinelVault/SentinelItem/field",
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Refused: this op command prints secret values (read-stdout).",
      );
      expect(result.stderr).toContain("op run");
      expect(result.stderr).not.toContain("SentinelVault");
      expect(result.stderr).not.toContain("SentinelItem");
      expect(result.stderr).not.toContain("op://");
    });

    test("refuses op inject to stdout", () => {
      expectRefused(
        ["primary", "op", "inject", "-i", "SentinelTemplate"],
        "Refused: this op command prints secret values (inject-stdout).",
      );
    });

    test("refuses op document get to stdout without echoing the document", () => {
      const { result } = runOpchainOp([
        "primary",
        "--read",
        "op",
        "document",
        "get",
        "SentinelDoc",
      ]);

      expect(result.stderr).toContain(
        "Refused: this op command prints secret values (document-get-stdout).",
      );
      expect(result.stderr).not.toContain("SentinelDoc");
    });

    test("refuses op item get with --reveal, --otp, or --format json", () => {
      expectRefused(
        [
          "primary",
          "--read",
          "op",
          "item",
          "get",
          "SentinelItem",
          "--vault",
          "SentinelVault",
          "--reveal",
        ],
        "Refused: this op command prints secret values (item-get-reveal).",
      );
      expectRefused(
        ["primary", "--read", "op", "item", "get", "SentinelItem", "--otp"],
        "Refused: this op command prints secret values (item-get-reveal).",
      );
      expectRefused(
        [
          "primary",
          "--read",
          "op",
          "item",
          "get",
          "SentinelItem",
          "--format",
          "json",
        ],
        "Refused: this op command prints secret values (item-get-reveal).",
      );
    });

    test("refuses op item create and item edit reveals", () => {
      expectRefused(
        ["primary", "--write", "op", "item", "create", "--reveal"],
        "Refused: this op command prints secret values (item-write-reveal).",
      );
      expectRefused(
        [
          "primary",
          "--write",
          "op",
          "item",
          "edit",
          "SentinelItem",
          "--format=json",
        ],
        "Refused: this op command prints secret values (item-write-reveal).",
      );
    });

    test("refuses op run --no-masking", () => {
      expectRefused(
        ["primary", "op", "run", "--no-masking", "--", "cmd"],
        "Refused: this op command prints secret values (run-no-masking).",
      );
    });

    test("refuses op signin including --raw", () => {
      expectRefused(
        ["primary", "op", "signin"],
        "Refused: this op command prints secret values (signin).",
      );
      expectRefused(
        ["primary", "op", "signin", "--raw"],
        "Refused: this op command prints secret values (signin).",
      );
    });

    test("refuses token-printing create commands", () => {
      expectRefused(
        ["primary", "op", "service-account", "create", "SentinelName"],
        "Refused: this op command prints secret values (token-create).",
      );
      expectRefused(
        ["primary", "op", "connect", "token", "create", "SentinelName"],
        "Refused: this op command prints secret values (token-create).",
      );
      expectRefused(
        ["primary", "op", "events-api", "create", "SentinelName"],
        "Refused: this op command prints secret values (token-create).",
      );
    });

    test("refuses confirmed aliases of guarded paths", () => {
      expectRefused(
        ["primary", "--read", "op", "items", "get", "SentinelItem", "--otp"],
        "Refused: this op command prints secret values (item-get-reveal).",
      );
      expectRefused(
        ["primary", "--read", "op", "documents", "get", "SentinelDoc"],
        "Refused: this op command prints secret values (document-get-stdout).",
      );
      expectRefused(
        ["primary", "op", "sa", "create", "SentinelName"],
        "Refused: this op command prints secret values (token-create).",
      );
      expectRefused(
        ["primary", "op", "connect", "tokens", "create", "SentinelName"],
        "Refused: this op command prints secret values (token-create).",
      );
    });

    test("refuses unclassifiable flag ordering without echoing arguments", () => {
      const { result } = runOpchainOp([
        "primary",
        "--read",
        "op",
        "item",
        "--vault",
        "SentinelVault",
        "get",
        "SentinelItem",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Refused: opchain cannot tell whether this op command prints secret values.",
      );
      expect(result.stderr).toContain("after the subcommand");
      expect(result.stderr).not.toContain("SentinelVault");
      expect(result.stderr).not.toContain("SentinelItem");
    });
  });

  describe("opchain flag positions on refusals", () => {
    for (const row of REFUSAL_FORM_ROWS) {
      test(`refuses ${rowLabel(row)} in every accepted flag position`, () => {
        const positions: readonly (readonly string[])[] = [
          [row.profileFlag, "primary", "op", ...row.opArgs],
          ["primary", row.profileFlag, "op", ...row.opArgs],
          ["--debug", "primary", row.profileFlag, "op", ...row.opArgs],
        ];

        for (const [index, argv] of positions.entries()) {
          const { opLogPath, result, securityLogPath } = runOpchainOp(argv);

          expect(result.status).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain(refusalHeadline(row.form));
          expectNoSentinelValue(result.stderr);
          expect(existsSync(opLogPath)).toBe(false);
          expect(existsSync(securityLogPath)).toBe(false);

          // Plain positions emit no telemetry, so the refusal is the first
          // thing on stderr; the --debug position carries telemetry first.
          if (index < 2) {
            expect(result.stderr.startsWith("Refused:")).toBe(true);
          }
        }
      });
    }
  });

  describe("--allow-reveal without a TTY", () => {
    for (const row of REFUSAL_FORM_ROWS) {
      test(`refuses ${rowLabel(row)} with the no-TTY message in every accepted flag position`, () => {
        const positions: readonly (readonly string[])[] = [
          ["--allow-reveal", row.profileFlag, "primary", "op", ...row.opArgs],
          ["primary", "--allow-reveal", row.profileFlag, "op", ...row.opArgs],
          [
            "--debug",
            "--allow-reveal",
            "primary",
            row.profileFlag,
            "op",
            ...row.opArgs,
          ],
        ];

        for (const argv of positions) {
          const { opLogPath, result, securityLogPath } = runOpchainOp(argv);

          expect(result.status).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain(
            "--allow-reveal requires an interactive terminal (stdin is not a TTY).",
          );
          expect(existsSync(opLogPath)).toBe(false);
          expect(existsSync(securityLogPath)).toBe(false);
        }
      });
    }

    test("emits no_tty refusal telemetry with debug JSON", () => {
      const { result } = runOpchainOp([
        "--debug",
        "--debug-format",
        "json",
        "--allow-reveal",
        "primary",
        "op",
        "read",
        "op://Vault/Item/field",
      ]);

      expect(result.status).toBe(1);

      const events = parseTelemetryEvents(result.stderr);
      const refusal = events.find(
        (event) => event.name === "op.reveal.refused",
      );

      expect(refusal?.attributes).toEqual({
        form: "read-stdout",
        identity: "primary",
        reason: "no_tty",
      });
    });
  });

  describe("refusal telemetry", () => {
    test("emits op.reveal.refused with reason reveal", () => {
      const { result } = runOpchainOp([
        "--debug",
        "--debug-format",
        "json",
        "primary",
        "op",
        "read",
        "op://Vault/Item/field",
      ]);

      expect(result.status).toBe(1);

      const events = parseTelemetryEvents(result.stderr);
      const refusal = events.find(
        (event) => event.name === "op.reveal.refused",
      );

      expect(refusal?.attributes).toEqual({
        form: "read-stdout",
        identity: "primary",
        reason: "reveal",
      });
    });
  });

  describe("command-name telemetry", () => {
    test("reports only the classified command path, never argument values", () => {
      const homePath = mkdtempSync(join(tmpdir(), "opchain-reveal-cmd-"));
      const outFile = join(homePath, "out.txt");
      const { result } = runOpchainOp([
        "--debug",
        "--debug-format",
        "json",
        "primary",
        "--read",
        "op",
        "read",
        "-o",
        outFile,
        "op://SentinelVault/SentinelItem/field",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('"command_name":"read"');
      expect(result.stderr).not.toContain("SentinelVault");
      expect(result.stderr).not.toContain("SentinelItem");
    });
  });

  describe("--allow-reveal on a TTY", () => {
    test("--allow-reveal is a no-op for non-reveal commands", () => {
      const { opLogPath, result } = runOpchainOp([
        "--allow-reveal",
        "primary",
        "op",
        "vault",
        "list",
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("vault list ok\n");
      expect(result.stderr).toBe("");
      expect(readFileSync(opLogPath, "utf8")).toContain("args=vault list");
    });

    for (const row of REFUSAL_FORM_ROWS) {
      if (row.form === "unclassifiable-order") {
        continue;
      }

      test(`runs ${rowLabel(row)} with unchanged arguments`, () => {
        const homePath = mkdtempSync(join(tmpdir(), "opchain-reveal-tty-"));
        writeAutoReadWriteConfig(homePath);
        const opLogPath = join(homePath, "op.log");
        const securityLogPath = join(homePath, "security.log");
        const profileMode = row.profileFlag === "--write" ? "write" : "read";

        const expectScript = [
          "log_user 1",
          "set timeout 15",
          `spawn $env(BUN_BIN) run src/index.ts primary ${row.profileFlag} --allow-reveal op ${row.opArgs.join(" ")}`,
          "expect eof",
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
            OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
            OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
            OPCHAIN_TEST_OP_PASSTHROUGH: "1",
          },
        });

        expect(result.status).toBe(0);
        const opLog = readFileSync(opLogPath, "utf8");
        expect(opLog.split("\n")[0]).toBe(`args=${row.opArgs.join(" ")}`);
        expect(opLog).toBe(
          `args=${row.opArgs.join(" ")}\ntoken=token-for-primary-read\n`,
        );
        expect(readFileSync(securityLogPath, "utf8")).toBe(
          `service=opchain\naccount=opchain:primary:${profileMode}\n`,
        );
      });
    }

    test("emits op.reveal.allowed telemetry for an allow-reveal run", () => {
      const homePath = mkdtempSync(join(tmpdir(), "opchain-reveal-tty-"));
      writeAutoReadWriteConfig(homePath);
      const opLogPath = join(homePath, "op.log");
      const securityLogPath = join(homePath, "security.log");

      const expectScript = [
        "log_user 1",
        "set timeout 15",
        "spawn $env(BUN_BIN) run src/index.ts --debug primary --read --allow-reveal op read op://SentinelVault/SentinelItem/field",
        "expect eof",
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
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("secret ok");
      expect(result.stdout).toContain("op.reveal.allowed");
      expect(readFileSync(opLogPath, "utf8")).toBe(
        `${[
          "args=read op://SentinelVault/SentinelItem/field",
          "token=token-for-primary-read",
        ].join("\n")}
`,
      );
      expect(readFileSync(securityLogPath, "utf8")).toBe(
        `${["service=opchain", "account=opchain:primary:read"].join("\n")}
`,
      );
    });
  });

  describe("allowed forms run unchanged", () => {
    /**
     * Asserts one allowed command ran through to the fake op unchanged.
     *
     * @param argv - Full opchain argv.
     * @param expectedOpArgs - Expected `args=` log line content.
     * @param expectedStdout - Expected stdout fragment.
     */
    function expectAllowed(
      argv: readonly string[],
      expectedOpArgs: string,
      expectedStdout: string,
    ): void {
      const { opLogPath, result, securityLogPath } = runOpchainOp(argv);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(expectedStdout);
      expect(result.stderr).toBe("");
      expect(existsSync(securityLogPath)).toBe(true);
      expect(readFileSync(opLogPath, "utf8")).toContain(
        `args=${expectedOpArgs}`,
      );
    }

    test("allows vault list and item list", () => {
      expectAllowed(
        ["primary", "op", "vault", "list"],
        "vault list",
        "vault list ok",
      );
      expectAllowed(
        ["primary", "--read", "op", "item", "list"],
        "item list",
        "item list ok",
      );
    });

    test("allows masked op run with and without --env-file", () => {
      expectAllowed(
        ["primary", "--read", "op", "run", "--", "npm", "start"],
        "run -- npm start",
        "run ok",
      );
      expectAllowed(
        [
          "primary",
          "--read",
          "op",
          "run",
          "--env-file",
          ".env.op",
          "--",
          "npm",
          "start",
        ],
        "run --env-file .env.op -- npm start",
        "run ok",
      );
    });

    test("allows op read, op inject, and op document get with out-files", () => {
      expectAllowed(
        [
          "primary",
          "--read",
          "op",
          "read",
          "-o",
          "out.txt",
          "op://Vault/Item/field",
        ],
        "read -o out.txt op://Vault/Item/field",
        "secret ok",
      );
      expectAllowed(
        ["primary", "--read", "op", "inject", "-i", "t.op", "-o", "out.txt"],
        "inject -i t.op -o out.txt",
        "inject ok",
      );
      expectAllowed(
        [
          "primary",
          "--read",
          "op",
          "document",
          "get",
          "SentinelDoc",
          "--out-file",
          "doc.pdf",
        ],
        "document get SentinelDoc --out-file doc.pdf",
        "document get ok",
      );
    });

    test("allows default human-readable item get, create, and edit", () => {
      expectAllowed(
        ["primary", "--read", "op", "item", "get", "SentinelItem"],
        "item get SentinelItem",
        "item-uuid-1",
      );
      expectAllowed(
        ["primary", "--write", "op", "item", "create", "--category", "login"],
        "item create --category login",
        "item create ok",
      );
      expectAllowed(
        [
          "primary",
          "--write",
          "op",
          "item",
          "edit",
          "SentinelItem",
          "--vault",
          "Services",
        ],
        "item edit SentinelItem --vault Services",
        "item edit ok",
      );
    });
  });

  describe("delegated op environment", () => {
    test("OP_FORMAT from the caller env does not reach the op child", () => {
      const { opLogPath, result } = runOpchainOp(
        ["primary", "--read", "op", "item", "get", "SentinelItem"],
        { OPCHAIN_TEST_OP_LOG_ENV: "1", OP_FORMAT: "json" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const opLog = readFileSync(opLogPath, "utf8");
      expect(opLog).toContain("args=item get SentinelItem");
      expect(opLog).toContain("op_format=\n");
    });
  });
});
