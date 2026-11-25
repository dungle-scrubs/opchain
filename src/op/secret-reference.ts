/** One `op://<vault>/<item>[/<section>]/<field>` reference, split. */
export type ParsedSecretReference = {
  readonly field: string;
  readonly item: string;
  readonly section: string | undefined;
  readonly vault: string;
};

const SECRET_REFERENCE_PREFIX = "op://";

/**
 * Splits a secret reference into the parts `op item get` and a field lookup
 * need. `op item get` takes an item and a `--vault`, never a whole reference.
 * A query such as `?attribute=otp` selects a field attribute and is dropped.
 *
 * @param reference - Raw `op://` reference.
 * @returns {ParsedSecretReference | undefined} The parts, or undefined when
 *   the reference does not have three or four non-empty segments.
 */
export function parseSecretReference(
  reference: string,
): ParsedSecretReference | undefined {
  if (!reference.startsWith(SECRET_REFERENCE_PREFIX)) {
    return undefined;
  }

  const path =
    reference.slice(SECRET_REFERENCE_PREFIX.length).split("?")[0] ?? "";
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  const [vault, item, third, fourth] = segments;
  if (vault === undefined || item === undefined || third === undefined) {
    return undefined;
  }

  if (segments.length === 3) {
    return { field: third, item, section: undefined, vault };
  }

  if (segments.length === 4 && fourth !== undefined) {
    return { field: fourth, item, section: third, vault };
  }

  return undefined;
}
