/**
 * Content hashing for the auto-chart cache. Returns null when crypto.subtle
 * is unavailable (insecure context) — callers degrade to cache-less
 * generation rather than crashing.
 */

export async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}
