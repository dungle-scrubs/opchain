// Node-native synchronous parent for one relay CLI run.
//
// Bun's async child streams were observed losing stderr bytes and end
// events after the child was reaped, so the test helper does not read
// the CLI's pipes itself. This supervisor runs the CLI with
// child_process.spawnSync, whose `output` array holds every piped slot,
// including descriptor 3, and writes the raw bytes as base64 to the
// result file named in the request. The environment is inherited, never
// recorded.
//
// argv[2] is a JSON request: { command, args, fd3, resultPath }, where
// fd3 is "pipe", "none" (no slot 3), or { path } (a file opened for
// writing and passed as descriptor 3).

import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";

// The longest known synthetic fixture run settles a 3 s deadline plus
// escalation; anything past this bound is a fixture failure.
const TIMEOUT_MS = 15_000;

// Across all piped slots; the largest fixture value is 256 KiB.
const MAX_BUFFER = 4 * 1024 * 1024;

const request = JSON.parse(process.argv[2]);
let fileFd;
let result;
try {
  const stdio = ["pipe", "pipe", "pipe"];
  if (request.fd3 === "pipe") {
    stdio.push("pipe");
  } else if (request.fd3 !== "none") {
    fileFd = openSync(request.fd3.path, "w");
    stdio.push(fileFd);
  }

  const run = spawnSync(request.command, request.args, {
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
    stdio,
    timeout: TIMEOUT_MS,
  });
  if (run.error !== undefined) {
    throw run.error;
  }

  const encode = (bytes) => (bytes ?? Buffer.alloc(0)).toString("base64");
  result = {
    code: run.status,
    signal: run.signal,
    stderr: encode(run.output[2]),
    stdout: encode(run.output[1]),
    value: encode(run.output[3]),
  };
} catch (error) {
  result = { error: String(error?.stack ?? error) };
  process.exitCode = 1;
} finally {
  if (fileFd !== undefined) {
    closeSync(fileFd);
  }
}

writeFileSync(request.resultPath, JSON.stringify(result));
