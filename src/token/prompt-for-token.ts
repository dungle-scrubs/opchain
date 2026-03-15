import { spawnSync } from "node:child_process";

/**
 * Prompts for a token on an interactive TTY with input echo disabled.
 *
 * @param prompt - Prompt text shown to the operator.
 * @returns {Promise<string | null>} Token value or null when no interactive TTY is available.
 */
export async function promptForToken(prompt: string): Promise<string | null> {
  if (!isInteractiveTty()) {
    return null;
  }

  const disableEchoResult = spawnSync("stty", ["-echo"], {
    stdio: ["inherit", "ignore", "ignore"],
  });
  if (disableEchoResult.status !== 0 || disableEchoResult.error) {
    process.stdout.write("\n");
    return null;
  }

  process.stdout.write(prompt);

  try {
    const token = await readLineFromStdin();
    const normalizedToken = token.replace(/[\r\n]+$/, "");
    return normalizedToken.length > 0 ? normalizedToken : null;
  } finally {
    spawnSync("stty", ["echo"], {
      stdio: ["inherit", "ignore", "ignore"],
    });
    process.stdout.write("\n");
  }
}

/**
 * Prompts for a visible yes/no confirmation on an interactive TTY.
 *
 * @param prompt - Prompt text shown to the operator.
 * @returns {Promise<boolean | null>} True for yes, false for no, or null when no interactive TTY is available.
 */
export async function promptForConfirmation(
  prompt: string,
): Promise<boolean | null> {
  if (!isInteractiveTty()) {
    return null;
  }

  process.stdout.write(prompt);
  const response = await readLineFromStdin();
  const normalizedResponse = response.trim().toLowerCase();

  return normalizedResponse === "y" || normalizedResponse === "yes";
}

/**
 * Checks whether stdin and stdout are both interactive TTYs.
 *
 * @returns {boolean} True when interactive prompting is possible.
 */
function isInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Reads a single line from stdin without using readline echo helpers.
 *
 * @returns {Promise<string>} One line of stdin data.
 */
function readLineFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
    };

    const onData = (chunk: string | Buffer): void => {
      cleanup();
      resolve(chunk.toString());
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    process.stdin.resume();
    process.stdin.once("data", onData);
    process.stdin.once("error", onError);
  });
}
