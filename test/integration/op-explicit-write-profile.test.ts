import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

describe("explicit write-profile op execution", () => {
  test("resolves the write profile when --write is passed", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const helperGetLogPath = join(homePath, "helper-get-write.log");
    const opLogPath = join(homePath, "op-write.log");

    writeAutoReadWriteConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "kevin",
        "--write",
        "op",
        "item",
        "edit",
        "Stripe",
        "--vault",
        "Services",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_GET_LOG: helperGetLogPath,
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-kevin-write",
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("item edit ok\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(helperGetLogPath, "utf8")).toBe(
      `${["service=opchain-v2", "account=opchain-v2:kevin:write"].join("\n")}
`,
    );
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `${[
        "args=item edit Stripe --vault Services",
        "token=token-for-kevin-write",
      ].join("\n")}
`,
    );
  });
});
