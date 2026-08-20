/** The balanced JSON-ish region starting at `start` (which must be `{` or `[`), or null. */
function balancedFrom(s: string, start: number): string | null {
  const openChar = s[start];
  const closeChar = openChar === "{" ? "}" : openChar === "[" ? "]" : "";
  if (!closeChar) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract a JSON value from a model text response. Prefers a fenced ```json block; otherwise
 * scans left-to-right for balanced `{…}` / `[…]` regions and returns the FIRST that actually
 * parses — so stray braces in prose (`{problems: 1}`), unquoted-key noise, or a top-level array
 * don't break extraction of the real JSON.
 */
export function jsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch !== "{" && ch !== "[") continue;
    const region = balancedFrom(candidate, i);
    if (!region) continue;
    try {
      return JSON.parse(region);
    } catch {
      // not valid JSON here (e.g. prose braces) — keep scanning
    }
  }
  throw new Error("no JSON value found in model response");
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 30_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${url} → HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
