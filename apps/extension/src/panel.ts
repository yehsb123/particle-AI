/**
 * Side panel addressing. The body's URL is configured in one place — the iframe's data-src in
 * sidepanel.html — and everything else is derived from it, so the panel cannot end up probing
 * one address while pointing the frame at another.
 */

/** Where to check whether the body is up: the origin of the URL the frame will load. */
export function probeUrl(bodySrc: string): string {
  try {
    return new URL(bodySrc).origin + "/";
  } catch {
    return "http://localhost:3000/";
  }
}

/**
 * The body runs in a page that cannot read the extension's storage, so a configured runtime
 * token travels in its URL. An empty or whitespace-only token adds nothing.
 */
export function bodyUrl(bodySrc: string, token: unknown): string {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) return bodySrc;
  const separator = bodySrc.includes("?") ? "&" : "?";
  return `${bodySrc}${separator}token=${encodeURIComponent(t)}`;
}
