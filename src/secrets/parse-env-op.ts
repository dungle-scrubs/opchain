const OP_REFERENCE_PATTERN = /^op:\/\/.+$/;

/**
 * Lists unique `op://` references from one `.env.op` file.
 *
 * @param content - Raw `.env.op` file content.
 * @returns {readonly string[]} Unique secret references in encounter order.
 */
export function listSecretReferences(content: string): readonly string[] {
  const uniqueReferences = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7) : line;
    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const rawValue = normalizedLine.slice(equalsIndex + 1).trim();
    const value = stripWrappingQuotes(rawValue);
    if (OP_REFERENCE_PATTERN.test(value)) {
      uniqueReferences.add(value);
    }
  }

  return [...uniqueReferences];
}

/**
 * Removes a single pair of wrapping quotes from a value.
 *
 * @param value - Raw assigned value.
 * @returns {string} Unquoted value when wrapped.
 */
function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
