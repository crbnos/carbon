/**
 * Minimal user-agent classification for display ("Chrome on macOS").
 * Deliberately not a full UA parser: sign-in activity only needs a
 * recognizable family name, and anything unmatched falls back to null so
 * callers can show the raw string instead.
 */

export type ParsedUserAgent = {
  browser: string | null;
  os: string | null;
};

// Order matters: more specific tokens first (Edge/Opera embed "Chrome",
// Chrome embeds "Safari").
const BROWSERS: [RegExp, string][] = [
  [/edg(?:e|a|ios)?\//i, "Edge"],
  [/opr\/|opera/i, "Opera"],
  [/samsungbrowser\//i, "Samsung Internet"],
  [/firefox\/|fxios\//i, "Firefox"],
  [/chrome\/|crios\//i, "Chrome"],
  [/safari\//i, "Safari"]
];

// iOS before macOS: iPadOS user agents can carry "like Mac OS X".
const OPERATING_SYSTEMS: [RegExp, string][] = [
  [/iphone|ipad|ipod/i, "iOS"],
  [/android/i, "Android"],
  [/windows/i, "Windows"],
  [/mac os x|macintosh/i, "macOS"],
  [/cros/i, "ChromeOS"],
  [/linux/i, "Linux"]
];

export function parseUserAgent(
  userAgent: string | null | undefined
): ParsedUserAgent {
  if (!userAgent) return { browser: null, os: null };
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const os = OPERATING_SYSTEMS.find(([pattern]) =>
    pattern.test(userAgent)
  )?.[1];
  return { browser: browser ?? null, os: os ?? null };
}
