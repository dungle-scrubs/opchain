/** One `op://<vault>/<item>[/<section>]/<field>` reference, split. */
export type ParsedSecretReference = {
  readonly field: string;
  readonly item: string;
  readonly section: string | undefined;
  readonly vault: string;
};

const SECRET_REFERENCE_PREFIX = "op://";

/**
 * The characters 1Password allows in a reference segment: letters, digits,
 * hyphens, underscores, periods and spaces. Any other name is referenced by
 * its ID. https://developer.1password.com/docs/cli/secret-reference-syntax/
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9_. -]+$/;

/**
 * Splits a secret reference into the parts `op item get` and a field lookup
 * need. `op item get` takes an item and a `--vault`, never a whole reference.
 * A query such as `?attribute=otp` selects a field attribute and is dropped.
 *
 * @param reference - Raw `op://` reference.
 * @returns {ParsedSecretReference | undefined} The parts, or undefined when
 *   the reference does not have three or four segments of allowed characters.
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
  if (segments.some((segment) => !SEGMENT_PATTERN.test(segment))) {
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
