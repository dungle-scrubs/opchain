import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "opchain-sign-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const binaries = [join(root, "opchain"), join(root, "oprun")];
  for (const binary of binaries) writeFileSync(binary, "plain fixture");
  const tools = {
    security: `printf 'security %s\\n' "$*" >> "$FAKE_LOG"
if [[ \${FAKE_IDENTITIES+x} ]]; then printf '%s\\n' "$FAKE_IDENTITIES"; else printf '%s\\n' '  1) ABC "Test Identity"'; fi
exit "\${FAKE_SECURITY_EXIT:-0}"`,
    codesign: `printf 'codesign %s\\n' "$*" >> "$FAKE_LOG"
for arg in "$@"; do
  case "$arg" in
    --sign)
      if [[ -n "\${FAKE_TS_FAILS:-}" ]]; then
        count=$(cat "$FAKE_LOG.ts" 2>/dev/null || echo 0)
        if (( count < FAKE_TS_FAILS )); then
          echo $((count + 1)) > "$FAKE_LOG.ts"
          printf '%s: The timestamp service is not available.\\n' "\${!#}" >&2
          exit 1
        fi
      fi
      exit "\${FAKE_SIGN_EXIT:-0}" ;;
    --verify) exit "\${FAKE_VERIFY_EXIT:-0}" ;;
  esac
done
if [[ "$1" == -dv ]]; then
  printf 'Identifier=dev.opchain.%s\\n' "$(basename "\${!#}")" >&2
  printf 'CodeDirectory v=20500 %s\\n' "\${FAKE_FLAGS:-flags=0x10000(runtime)}" >&2
  printf 'TeamIdentifier=%s\\n' "\${FAKE_TEAM:-TEAM123}" >&2
fi`,
  };
  for (const [name, body] of Object.entries(tools)) {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return {
    bin,
    binaries,
    run(args: string[], env: Record<string, string> = {}) {
      const result = spawnSync(
        "bash",
        [join(process.cwd(), "scripts/sign-macos.sh"), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FAKE_LOG: log,
            ...env,
          },
        },
      );
      const lines = existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n")
        : [];
      return {
        ...result,
        lines,
        signs: lines.filter((line) => line.includes(" --sign ")),
      };
    },
  };
}

test("signs and verifies two binaries with runtime and timestamp in order", () => {
  const f = fixture();
  const r = f.run([
    "--team-id",
    "TEAM123",
    "--timestamp",
    "--identity",
    "Test Identity",
    ...f.binaries,
  ]);
  expect(r.status).toBe(0);
  expect(r.signs).toEqual(
    f.binaries.map(
      (binary, i) =>
        `codesign --force --options runtime --timestamp --sign Test Identity --identifier dev.opchain.${i === 0 ? "opchain" : "oprun"} ${binary}`,
    ),
  );
  expect(r.lines).toEqual([
    "security find-identity -v -p codesigning",
    ...f.binaries.flatMap((binary, i) => [
      `codesign --force --options runtime --timestamp --sign Test Identity --identifier dev.opchain.${i === 0 ? "opchain" : "oprun"} ${binary}`,
      `codesign --verify --strict ${binary}`,
      `codesign -dv ${binary}`,
    ]),
  ]);
  expect(r.stdout).toBe(
    f.binaries
      .map(
        (binary, i) =>
          `signed ${binary} as dev.opchain.${i === 0 ? "opchain" : "oprun"}\n`,
      )
      .join(""),
  );
});

test("omits timestamp unless requested", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries]);
  expect(r.status).toBe(0);
  expect(r.signs).toEqual(
    f.binaries.map(
      (binary, i) =>
        `codesign --force --options runtime --sign Test Identity --identifier dev.opchain.${i === 0 ? "opchain" : "oprun"} ${binary}`,
    ),
  );
});

test("rejects an identity absent from the quoted identity list", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_IDENTITIES: '  1) ABC "Other Test Identity"',
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    "error: signing identity not found: Test Identity",
  );
  expect(r.signs).toEqual([]);
});

test("treats a failed security listing as a missing identity", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_SECURITY_EXIT: "1",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    "error: signing identity not found: Test Identity",
  );
  expect(r.signs).toEqual([]);
});

test("stops after the first failed signing call", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_SIGN_EXIT: "1",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`error: codesign failed for ${f.binaries[0]}`);
  expect(r.signs).toHaveLength(1);
  expect(r.lines).toHaveLength(2);
});

test("retries a timestamp outage, then signs", () => {
  const f = fixture();
  const r = f.run(
    ["--identity", "Test Identity", "--timestamp", ...f.binaries],
    {
      FAKE_TS_FAILS: "2",
      OPCHAIN_SIGN_RETRY_DELAY: "0",
    },
  );
  expect(r.status).toBe(0);
  expect(r.signs).toHaveLength(4);
  expect(r.stderr).toContain(
    `retrying ${f.binaries[0]}: timestamp service unavailable (attempt 2 of 5)`,
  );
  expect(r.stdout).toContain(`signed ${f.binaries[1]} as dev.opchain.oprun`);
});

test("gives up after five timestamp outages", () => {
  const f = fixture();
  const r = f.run(
    ["--identity", "Test Identity", "--timestamp", ...f.binaries],
    {
      FAKE_TS_FAILS: "9",
      OPCHAIN_SIGN_RETRY_DELAY: "0",
    },
  );
  expect(r.status).toBe(1);
  expect(r.signs).toHaveLength(5);
  expect(r.stderr).toContain(`error: codesign failed for ${f.binaries[0]}`);
});

test("does not retry a timestamp message without --timestamp", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_TS_FAILS: "1",
    OPCHAIN_SIGN_RETRY_DELAY: "0",
  });
  expect(r.status).toBe(1);
  expect(r.signs).toHaveLength(1);
});

test("rejects the wrong team with the observed team in its error", () => {
  const f = fixture();
  const r = f.run(
    ["--identity", "Test Identity", "--team-id", "TEAM123", ...f.binaries],
    { FAKE_TEAM: "OTHER" },
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("TeamIdentifier is OTHER, expected TEAM123");
  expect(r.signs).toHaveLength(1);
});

test("rejects a signature without hardened runtime", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_FLAGS: "flags=0x0(none)",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    `error: ${f.binaries[0]}: hardened runtime is missing`,
  );
  expect(r.signs).toHaveLength(1);
});

test("rejects failed strict verification before inspecting the signature", () => {
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    FAKE_VERIFY_EXIT: "1",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    `error: ${f.binaries[0]}: strict verification failed`,
  );
  expect(r.lines.some((line) => line.includes(" -dv "))).toBe(false);
});

test("requires an identity and binaries and rejects malformed options", () => {
  const f = fixture();
  for (const args of [
    [],
    ["--unknown"],
    ["--identity"],
    ["--identity", ""],
    ["--identity", "--timestamp"],
    ["--team-id"],
    ["--team-id", "", "--identity", "Test Identity", ...f.binaries],
    ["--identity", "Test Identity"],
    f.binaries,
  ]) {
    const r = f.run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "Usage: sign-macos.sh --identity <name> [--team-id <id>] [--timestamp] <binary>...",
    );
    expect(r.lines).toEqual([]);
  }
});

test("checks every binary before signing any of them", () => {
  const f = fixture();
  const missing = `${f.binaries[1]}-missing`;
  const r = f.run([
    "--identity",
    "Test Identity",
    f.binaries[0] ?? "",
    missing,
  ]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`error: not a file: ${missing}`);
  expect(r.lines).toEqual([]);
});

test("supports macOS system Bash without a timestamp", () => {
  if (process.platform !== "darwin") return;
  const f = fixture();
  const r = f.run(["--identity", "Test Identity", ...f.binaries], {
    PATH: `${f.bin}:/usr/bin:/bin`,
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.signs).toHaveLength(2);
  expect(r.signs.join("\n")).not.toContain("--timestamp");
});
