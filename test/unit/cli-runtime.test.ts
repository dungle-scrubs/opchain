import { describe, expect, test } from "bun:test";
import type { TelemetryEvent } from "../../src/telemetry/event.ts";
import { runCli, type CliRuntimeDeps } from "../../src/cli/runtime.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";

/**
 * Creates one fully stubbed runtime dependency set with captured output.
 *
 * @param overrides - Dependency overrides for one test case.
 * @returns {Readonly<{ deps: CliRuntimeDeps; stderr: string[]; stdout: string[]; telemetry: TelemetryEvent[] }>} Runtime deps plus captured side effects.
 */
function createRuntimeDeps(overrides: Partial<CliRuntimeDeps> = {}): Readonly<{
  deps: CliRuntimeDeps;
  stderr: string[];
  stdout: string[];
  telemetry: TelemetryEvent[];
}> {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const telemetry: TelemetryEvent[] = [];

  return {
    deps: {
      buildProgram: () => ({ helpInformation: () => "HELP\n" }),
      findCommandDispatch: () => null,
      parseCliOptions: () => createCliOptions(),
      resolveCommandName: () => "unknown",
      writeStderr: (text) => {
        stderr.push(text);
      },
      writeStdout: (text) => {
        stdout.push(text);
      },
      writeTelemetry: (_options, event) => {
        telemetry.push(event);
      },
      ...overrides,
    },
    stderr,
    stdout,
    telemetry,
  };
}

describe("runCli", () => {
  test("writes help to stdout and exits zero in help mode", async () => {
    const runtime = createRuntimeDeps({
      parseCliOptions: () => createCliOptions({ help: true }),
    });

    const exitCode = await runCli(["--help"], runtime.deps);

    expect(exitCode).toBe(0);
    expect(runtime.stdout).toEqual(["HELP\n"]);
    expect(runtime.stderr).toEqual([]);
    expect(runtime.telemetry).toHaveLength(1);
    expect(runtime.telemetry[0]?.name).toBe("cli.start");
  });

  test("writes help to stderr and exits one for unsupported commands", async () => {
    const runtime = createRuntimeDeps({
      parseCliOptions: () => createCliOptions({ commandArgs: ["unknown"] }),
    });

    const exitCode = await runCli(["unknown"], runtime.deps);

    expect(exitCode).toBe(1);
    expect(runtime.stdout).toEqual([]);
    expect(runtime.stderr).toEqual(["HELP\n"]);
    expect(runtime.telemetry).toHaveLength(1);
    expect(runtime.telemetry[0]?.name).toBe("cli.start");
  });

  test("dispatches the matched handler and emits startup telemetry", async () => {
    const options = createCliOptions({
      commandArgs: ["doctor"],
      debug: true,
      debugFormat: "json",
    });
    const handledOptions: (typeof options)[] = [];
    const runtime = createRuntimeDeps({
      findCommandDispatch: (receivedOptions) => ({
        handler: async (request) => {
          handledOptions.push(request.options);
          return {
            exitCode: 17,
            stderr: "",
            stdout: "handled\n",
          };
        },
        request: {
          kind: "top",
          options: receivedOptions,
          trailingArgs: [],
        },
      }),
      parseCliOptions: () => options,
      resolveCommandName: () => "doctor",
    });

    const exitCode = await runCli(["doctor"], runtime.deps);

    expect(exitCode).toBe(17);
    expect(handledOptions).toEqual([options]);
    expect(runtime.stdout).toEqual(["handled\n"]);
    expect(runtime.stderr).toEqual([]);
    expect(runtime.telemetry).toHaveLength(1);
    expect(runtime.telemetry[0]?.name).toBe("cli.start");
    expect(runtime.telemetry[0]?.attributes.command).toBe("doctor");
    expect(runtime.telemetry[0]?.attributes.debug_format).toBe("json");
  });
});
