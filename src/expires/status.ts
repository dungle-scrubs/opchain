/**
 * Classifies one expiry timestamp relative to the configured threshold.
 *
 * @param expiresAt - ISO expiry timestamp.
 * @param thresholdDays - Expiring threshold in days.
 * @returns {"expired" | "expiring" | "healthy"} Expiry status.
 */
export function classifyExpiryStatus(
  expiresAt: string,
  thresholdDays: number,
): "expired" | "expiring" | "healthy" {
  const expiresAtDate = new Date(expiresAt);
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const deltaMs = expiresAtDate.getTime() - now;

  if (deltaMs < 0) {
    return "expired";
  }

  if (deltaMs <= thresholdMs) {
    return "expiring";
  }

  return "healthy";
}
