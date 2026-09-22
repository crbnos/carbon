export type ParsedUserAgent = {
  browser: string | null;
  os: string | null;
};

const BROWSERS: [RegExp, string][] = [
  [/edg(?:e|a|ios)?\//i, "Edge"],
  [/opr\/|opera/i, "Opera"],
  [/samsungbrowser\//i, "Samsung Internet"],
  [/firefox\/|fxios\//i, "Firefox"],
  [/chrome\/|crios\//i, "Chrome"],
  [/safari\//i, "Safari"]
];

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
