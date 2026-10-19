import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "./write-opchain-config.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");

export const RELAY_OP_FIXTURE_PATH = OP_FIXTURE_PATH;
export const RELAY_SECURITY_FIXTURE_PATH = SECURITY_FIXTURE_PATH;

/** How descriptor 3 is wired for the spawned opchain CLI. */
export type RelayStdio3 =
  | { readonly kind: "pipe" }
  | { readonly kind: "closed" }
  | { readonly kind: "duplicate-of"; readonly fd: 1 | 2 }
  | { readonly kind: "file-path"; readonly path: string };

export type RelayRunResult = {
  readonly homePath: string;
  readonly opLogPath: string;
  readonly result: { code: number | null; signal: string | null };
  readonly securityLogPath: string;
  readonly stderrText: string;
  readonly stdoutText: string;
  readonly valueBytes: Buffer;
};

/** Peer behavior on the descriptor-3 stream. */
export type RelayPeerMode = "drain" | "stall-after-first-chunk" | "destroy-after-first-chunk";

/**
 * Runs one opchain relay invocation with descriptor 3 wired per `stdio3`
 * and every stream drained concurrently.
 *
 * @param argvAfterBinary - Arguments between `bun run src/index.ts` and the end.
 * @param options - Descriptor 3 wiring, extra env, and peer behavior.
 * @returns {Promise<RelayRunResult>} Captured streams plus fixture log paths.
 */
export async function runRelay(
  argvAfterBinary: readonly string[],
  options: {
    readonly env?: Record<string, string>;
    readonly peerMode?: RelayPeerMode;
    readonly stdio3?: RelayStdio3;
  } = {},
): Promise<RelayRunResult> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-"));
  writeAutoReadWriteConfig(homePath);
  const opLogPath = join(homePath, "op.log");
  const securityLogPath = join(homePath, "security.log");
  const peerMode = options.peerMode ?? "drain";

  let stdio3: "pipe" | number | undefined;
  let fileFd: number | undefined;
  switch (options.stdio3?.kind) {
    case undefined:
    case "pipe":
      stdio3 = "pipe";
      break;
    case "closed":
      stdio3 = undefined;
      break;
    case "duplicate-of":
      stdio3 = options.stdio3.fd;
      break;
    case "file-path":
      fileFd = openSync(options.stdio3.path, "w");
      stdio3 = fileFd;
      break;
  }

  const stdio: ("pipe" | number)[] = ["pipe", "pipe", "pipe"];
  if (stdio3 !== undefined) {
    stdio.push(stdio3);
  }

  // Bun's multi-pipe spawn occasionally fails stdio creation with a
  // transient ENOENT under heavy parallel spawn load - sometimes thrown
  // by spawn(), sometimes by the lazy child.stdio getters. Retrying the
  // whole spawn + stream wiring a bounded number of times keeps the
  // suite stable without masking real spawn errors.
  let child: ChildProcess | undefined;
  let valueStream:
    | { destroy(): void; on(event: "data", listener: (chunk: Buffer) => void): unknown; pause(): void }
    | null
    | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      child = spawn(process.execPath, [
        "run",
        "src/index.ts",
        ...argvAfterBinary,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
          OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
          OPCHAIN_TEST_OP_LOG: opLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
          ...options.env,
        },
        stdio,
      });
      // Touch every stdio getter now: the transient failure surfaces
      // here as well as in spawn itself.
      void child.stdout;
      void child.stderr;
      valueStream = child.stdio[3] as unknown as typeof valueStream;
      break;
    } catch (error) {
      void error;
      // If the throw came from the lazy stdio getters, the process is
      // already running; stop it before retrying.
      child?.kill("SIGKILL");
      if (attempt >= 3) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    }
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const valueChunks: Buffer[] = [];
  let firstChunkSeen = false;

  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  // For stdio slots past index 2, "pipe" hands the parent the read end;
  // the spawn types model it as Writable, so it was narrowed while
  // wiring above.
  if (valueStream !== null && valueStream !== undefined) {
    valueStream.on("data", (chunk: Buffer) => {
      valueChunks.push(chunk);
      if (peerMode === "drain" || firstChunkSeen) {
        return;
      }

      firstChunkSeen = true;
      if (peerMode === "stall-after-first-chunk") {
        valueStream.pause();
      } else {
        valueStream.destroy();
      }
    });
  }

  const [code, signal] = await new Promise<[number | null, string | null]>(
    (resolve) => {
      child.on("close", (exitCode, closeSignal) => {
        resolve([exitCode, closeSignal]);
      });
      child.on("error", () => {
        resolve([null, null]);
      });
    },
  );

  if (fileFd !== undefined) {
    closeSync(fileFd);
  }

  return {
    homePath,
    opLogPath,
    result: { code, signal },
    securityLogPath,
    stderrText: Buffer.concat(stderrChunks).toString("utf8"),
    stdoutText: Buffer.concat(stdoutChunks).toString("utf8"),
    valueBytes: Buffer.concat(valueChunks),
  };
}
