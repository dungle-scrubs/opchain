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
  const root = mkdtempSync(join(tmpdir(), "opchain-notary-"));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const key = join(root, "private.p8");
  writeFileSync(key, "SENTINEL-PRIVATE-KEY");
  const binaries = [join(root, "opchain"), join(root, "oprun")];
  for (const binary of binaries) writeFileSync(binary, "signed fixture");
  const tools = {
    ditto: `printf 'ditto %s\\n' "$*" >> "$FAKE_LOG"
touch "\${!#}"
exit "\${FAKE_DITTO_EXIT:-0}"`,
    xcrun: `printf 'xcrun %s\\n' "$*" >> "$FAKE_LOG"
if [[ "$2" == submit ]]; then
  if [[ -n "\${FAKE_NOTARY_STDOUT+set}" ]]; then printf '%s\\n' "$FAKE_NOTARY_STDOUT"; else
    printf '{"id":"sub-1","status":"%s"}\\n' "\${FAKE_NOTARY_STATUS:-Accepted}"
  fi
  exit 0
fi
printf '%s\\n' '{"issues":null}' > "\${!#}"
exit "\${FAKE_LOG_EXIT:-0}"`,
  };
  for (const [name, body] of Object.entries(tools)) {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return {
    root,
    key,
    binaries,
    run(
      env: Record<string, string | undefined> = {},
      args: string[] = binaries,
    ) {
      const result = spawnSync(
        "bash",
        [join(process.cwd(), "scripts/notarize-macos.sh"), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TMPDIR: root,
            FAKE_LOG: log,
            APPLE_API_KEY_PATH: key,
            APPLE_API_KEY_ID: "KEY123",
            APPLE_API_ISSUER_ID: "ISSUER123",
            NOTARY_TIMEOUT: "",
            ...env,
          },
        },
      );
      expect(result.stdout).not.toContain("SENTINEL-PRIVATE-KEY");
      expect(result.stderr).not.toContain("SENTINEL-PRIVATE-KEY");
      expect(result.stdout).not.toContain(key);
      expect(result.stderr).not.toContain(key);
      const lines = existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n")
        : [];
      const archive = lines
        .find((line) => line.startsWith("ditto "))
        ?.split(" ")
        .at(-1);
      if (archive) expect(existsSync(archive)).toBe(false);
      return {
        ...result,
        lines,
        xcrun: lines.filter((line) => line.startsWith("xcrun ")),
      };
    },
  };
}

test("submits once, fetches the log and reports acceptance without leaking the key", () => {
  const f = fixture();
  const r = f.run();
  expect(r.status).toBe(0);
  expect(r.xcrun).toHaveLength(2);
  expect(r.xcrun[0]).toMatch(
    new RegExp(
      `^xcrun notarytool submit .*/opchain-notarize.zip --key ${f.key} --key-id KEY123 --issuer ISSUER123 --wait --timeout 30m --output-format json$`,
    ),
  );
  expect(r.xcrun[1]).toMatch(
    new RegExp(
      `^xcrun notarytool log sub-1 --key ${f.key} --key-id KEY123 --issuer ISSUER123 .*/notary-log.json$`,
    ),
  );
  expect(r.stdout).toBe(
    'notary log:\n{"issues":null}\nnotarized: submission sub-1 Accepted\n',
  );
});

test("uses a caller-specified timeout", () => {
  const f = fixture();
  const r = f.run({ NOTARY_TIMEOUT: "5m" });
  expect(r.status).toBe(0);
  expect(r.xcrun[0]).toContain("--timeout 5m");
});

test("fetches the log and fails for Invalid status", () => {
  const f = fixture();
  const r = f.run({ FAKE_NOTARY_STATUS: "Invalid" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    "error: notarization Invalid for submission sub-1",
  );
  expect(r.xcrun[1]).toContain("notarytool log sub-1");
});

test("rejects unreadable or incomplete notarization results", () => {
  for (const output of [
    "not JSON",
    "{}",
    '{"id":null,"status":"Accepted"}',
    '{"id":"sub-1","status":null}',
  ]) {
    const f = fixture();
    const r = f.run({ FAKE_NOTARY_STDOUT: output });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: could not read the notarization result");
    expect(r.stderr).toContain(output);
    expect(r.xcrun).toHaveLength(1);
  }
});

test("requires binaries before checking the environment", () => {
  const f = fixture();
  const r = f.run({ APPLE_API_KEY_PATH: undefined }, []);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("Usage: notarize-macos.sh <binary>...");
  expect(r.lines).toEqual([]);
});

test("requires each API variable, unset or empty, in the documented order", () => {
  for (const name of [
    "APPLE_API_KEY_PATH",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
  ]) {
    for (const value of [undefined, ""]) {
      const f = fixture();
      const r = f.run({ [name]: value });
      expect(r.status).toBe(2);
      expect(r.stderr).toBe(`error: ${name} is not set\n`);
      expect(r.lines).toEqual([]);
    }
  }
  const f = fixture();
  expect(
    f.run({
      APPLE_API_KEY_PATH: "",
      APPLE_API_KEY_ID: "",
      APPLE_API_ISSUER_ID: "",
    }).stderr,
  ).toBe("error: APPLE_API_KEY_PATH is not set\n");
});

test("checks the key file before the binaries without printing its path", () => {
  const f = fixture();
  const r = f.run({ APPLE_API_KEY_PATH: f.root }, ["missing-binary"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toBe("error: API key file not found\n");
  expect(r.lines).toEqual([]);
});

test("checks every binary before archiving", () => {
  const f = fixture();
  const missing = join(f.root, "missing");
  const r = f.run({}, [...f.binaries, missing]);
  expect(r.status).toBe(1);
  expect(r.stderr).toBe(`error: not a file: ${missing}\n`);
  expect(r.lines).toEqual([]);
});

test("does not submit when archive creation fails", () => {
  const f = fixture();
  const r = f.run({ FAKE_DITTO_EXIT: "1" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: could not create the archive");
  expect(r.xcrun).toEqual([]);
});

test("warns but accepts when fetching the notary log fails", () => {
  const f = fixture();
  const r = f.run({ FAKE_LOG_EXIT: "1" });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("warning: could not fetch the notary log");
  expect(r.stdout).toBe("notarized: submission sub-1 Accepted\n");
  expect(r.xcrun).toHaveLength(2);
});
