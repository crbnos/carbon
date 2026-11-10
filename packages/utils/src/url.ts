// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const isUrl = (str: string) => {
  let url;

  try {
    url = new URL(str);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
};

// A leading `word:` is a scheme only when the word has no dot: `javascript:` and
// `mailto:` are schemes, `www.example.com:8080` is a host with a port.
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The href to render for a stored link value, or null when it must render as
 * plain text. Values reach the database from forms, the API, MCP and workflows,
 * so this runs at render time, never only at input.
 *
 * - Only http and https links are returned; `javascript:`, `data:` and every
 *   other scheme are refused.
 * - A value with no scheme (`www.example.com/part`) gets `https://`, so it
 *   cannot resolve as a path inside the app. It must have a dotted host.
 * - A value with whitespace inside it is refused.
 */
export function toSafeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const scheme = SCHEME.exec(trimmed)?.[1];
  const hasScheme = scheme !== undefined && !scheme.includes(".");
  const candidate = hasScheme
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!hasScheme && !url.hostname.includes(".")) return null;

  return url.href;
}

/**
 * A stored link value as shown in a table or panel: without the scheme, a
 * leading `www.` or a trailing slash, so the part that tells two links apart
 * fits in a narrow column. `https://www.example.com/parts/` → `example.com/parts`.
 * The full address stays in the href and the tooltip.
 */
export function toLinkLabel(value: string): string {
  const label = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
  return label || value.trim();
}

/**
 * Get favicon URL for a given website URL
 */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}
