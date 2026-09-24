/**
 * Breached-password screening via Have I Been Pwned's k-anonymity range API.
 * Only the first 5 hex chars of the SHA-1 hash ever leave the browser; the
 * password itself is never sent anywhere. Fails OPEN (returns 0) on network
 * errors or timeouts so a flaky connection never blocks signup.
 */
export async function pwnedCount(password: string, timeoutMs = 2500): Promise<number> {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof fetch === "undefined") return 0;
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return 0;
    return parseRangeResponse(await response.text(), suffix);
  } catch {
    return 0;
  }
}

/** Exported for tests: find `suffix` in a "SUFFIX:COUNT" per-line body. */
export function parseRangeResponse(body: string, suffix: string): number {
  const target = suffix.toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(":");
    if (candidate?.toUpperCase() === target) return Number.parseInt(count ?? "0", 10) || 0;
  }
  return 0;
}
