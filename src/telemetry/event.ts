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
 * Creates a minimal structured telemetry event.
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
    attributes,
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
