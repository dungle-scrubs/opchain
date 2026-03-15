type StderrCaptureResult<TValue> = {
  readonly result: TValue;
  readonly stderr: string;
};

/**
 * Captures writes to stderr while one callback runs.
 *
 * @param callback - Work executed while stderr is intercepted.
 * @returns {Promise<StderrCaptureResult<TValue>>} Callback result plus captured stderr.
 */
export async function captureStderr<TValue>(
  callback: () => Promise<TValue> | TValue,
): Promise<StderrCaptureResult<TValue>> {
  let stderr = "";
  const originalWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = ((chunk: unknown): boolean => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    return {
      result: await callback(),
      stderr,
    };
  } finally {
    process.stderr.write = originalWrite;
  }
}
