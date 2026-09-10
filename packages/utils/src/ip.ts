/**
 * IP display/storage helpers for sign-in activity. Proxies often report an
 * IPv4 client as an IPv4-mapped IPv6 address ("::ffff:127.0.0.1"); normalize
 * before storing or showing it. Private/loopback detection lets the UI say
 * "Local network" instead of pretending a geo lookup failed.
 */

export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped?.[1] ?? trimmed;
}

export function isPrivateIp(value: string | null | undefined): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;
  return (
    ip === "::1" ||
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^f[cd]/i.test(ip) || // fc00::/7 unique local
    /^fe[89ab]/i.test(ip) // fe80::/10 link local
  );
}

export type ClientIpOptions = {
  /** How many rightmost x-forwarded-for hops are our own proxies. */
  trustedProxyCount?: number;
  /** Explicit proxy addresses to skip, in addition to the count. */
  trustedProxyIps?: string[];
};

/**
 * The client address, read RIGHT to LEFT.
 *
 * The leftmost x-forwarded-for hop is whatever the client sent, so it is
 * attacker-controlled on any deployment whose edge appends rather than replaces
 * the header (Carbon's self-hosted Caddy does exactly this —
 * `trusted_proxies static private_ranges`). Walking from the right and skipping
 * the hops we know are ours yields the first address our own infrastructure
 * actually observed.
 *
 * With no trusted-proxy configuration this returns the RIGHTMOST hop, which is
 * the conservative answer: it may be our own proxy, but it is never
 * attacker-supplied.
 */
export function getClientIp(
  request: Request,
  options: ClientIpOptions = {}
): string | null {
  const { trustedProxyCount = 0, trustedProxyIps = [] } = options;

  // A repeated header arrives joined by ", " in the Fetch API, so one read
  // covers both shapes.
  const forwarded = request.headers.get("x-forwarded-for");
  const hops = (forwarded ?? "")
    .split(",")
    .map((hop) => normalizeIp(stripPort(hop)))
    .filter((hop): hop is string => hop !== null);

  if (hops.length === 0) {
    return normalizeIp(stripPort(request.headers.get("x-real-ip")));
  }

  const trusted = new Set(
    trustedProxyIps
      .map((ip) => normalizeIp(ip))
      .filter((ip): ip is string => ip !== null)
  );

  let index = hops.length - 1 - trustedProxyCount;
  while (index >= 0 && trusted.has(hops[index]!)) index--;

  // Everything was trusted: the leftmost hop is the only candidate left, and it
  // is the client's own claim. Prefer it over returning nothing, but it is
  // exactly the value the walk exists to avoid trusting blindly.
  return hops[Math.max(index, 0)] ?? null;
}

/**
 * Remove a ":port" suffix (AWS ALB appends one). IPv6 is bracketed when it
 * carries a port, so a bare colon-count check distinguishes the two safely.
 */
function stripPort(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1]!;
  const colons = trimmed.split(":").length - 1;
  if (colons === 1) return trimmed.split(":")[0]!;
  return trimmed;
}
