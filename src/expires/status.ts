/**
 * Classifies one expiry timestamp relative to the configured threshold.
 *
 * @param expiresAt - ISO expiry timestamp.
 * @param thresholdDays - Expiring threshold in days.
 * @returns {"expired" | "expiring" | "healthy" | "invalid"} Expiry status.
 */
export function classifyExpiryStatus(
  expiresAt: string,
  thresholdDays: number,
): "expired" | "expiring" | "healthy" | "invalid" {
  const expiresAtDate = new Date(expiresAt);
  const expiresAtMs = expiresAtDate.getTime();

  if (Number.isNaN(expiresAtMs)) {
    return "invalid";
  }

  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const deltaMs = expiresAtMs - now;

  if (deltaMs < 0) {
    return "expired";
  }

  if (deltaMs <= thresholdMs) {
    return "expiring";
  }

  return "healthy";
}
