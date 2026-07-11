type TelemetryEvent = {
  readonly attributes: Record<string, unknown>;
  readonly duration_ms: number;
  readonly name: string;
  readonly parent_span_id: string | null;
  readonly span_id: string;
  readonly status: "ok";
  readonly timestamp: string;
  readonly trace_id: string;
};

/**
 * Maximum length of a string attribute value before truncation. Keeps event
 * payloads bounded even when a caller passes an unexpectedly large value.
 */
const MAX_ATTRIBUTE_STRING_LENGTH = 512;

/** Placeholder substituted for redacted secret-shaped substrings. */
const REDACTED_PLACEHOLDER = "[REDACTED]";

/** Marker appended to string values that exceed the length cap. */
const TRUNCATION_MARKER = "...[truncated]";

/**
 * Matches 1Password service-account token shapes (`ops_` followed by a long
 * opaque body). Conservative on length to avoid redacting ordinary short
 * values such as command names, file paths, or identity/profile names.
 */
const SERVICE_ACCOUNT_TOKEN_PATTERN = /ops_[A-Za-z0-9+/=_-]{40,}/g;

/**
 * Redacts secret-shaped substrings and caps the length of a string value.
 *
 * @param value - Raw string attribute value.
 * @returns {string} Redacted and length-capped value.
 */
function redactStringValue(value: string): string {
  const redacted = value.replace(
    SERVICE_ACCOUNT_TOKEN_PATTERN,
    REDACTED_PLACEHOLDER,
  );

  if (redacted.length <= MAX_ATTRIBUTE_STRING_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_ATTRIBUTE_STRING_LENGTH)}${TRUNCATION_MARKER}`;
}

/**
 * Recursively applies redaction and truncation to any attribute value.
 *
 * Strings pass through {@link redactStringValue}; arrays and plain objects are
 * processed element-wise; all other value types are returned unchanged.
 *
 * @param value - Attribute value of unknown shape.
 * @returns {unknown} Sanitized value.
 */
function sanitizeAttributeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactStringValue(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeAttributeValue);
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      sanitized[key] = sanitizeAttributeValue(nested);
    }
    return sanitized;
  }

  return value;
}

/**
 * Applies the redaction/truncation pass to every attribute value.
 *
 * @param attributes - Raw attributes supplied by the caller.
 * @returns {Record<string, unknown>} Sanitized attributes.
 */
function sanitizeAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    sanitized[key] = sanitizeAttributeValue(value);
  }
  return sanitized;
}

/**
 * Creates a minimal structured telemetry event.
 *
 * Attribute values pass through a conservative redaction/truncation seam so
 * secret-shaped strings (e.g. service-account tokens) never reach the event
 * boundary regardless of call-site discipline.
 *
 * @param name - Event name.
 * @param attributes - Safe event attributes.
 * @returns {TelemetryEvent} Structured telemetry event.
 */
export function createTelemetryEvent(
  name: string,
  attributes: Record<string, unknown>,
): TelemetryEvent {
  const traceId = crypto.randomUUID().replaceAll("-", "");
  const spanId = traceId.slice(0, 16);

  return {
    attributes: sanitizeAttributes(attributes),
    duration_ms: 0,
    name,
    parent_span_id: null,
    span_id: spanId,
    status: "ok",
    timestamp: new Date().toISOString(),
    trace_id: traceId,
  };
}

export type { TelemetryEvent };
