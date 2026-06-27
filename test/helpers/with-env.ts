type EnvOverrides = Record<string, string | undefined>;

/**
 * Runs one async block with temporary environment-variable overrides.
 *
 * @param overrides - Environment overrides to apply for the callback.
 * @param callback - Async work executed under the temporary environment.
 * @returns {Promise<TValue>} Callback result.
 */
export async function withEnv<TValue>(
  overrides: EnvOverrides,
  callback: () => Promise<TValue>,
): Promise<TValue> {
  const previousValues = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }
}
