import { runCli } from "./cli/runtime.ts";

export { runCli as main };

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
