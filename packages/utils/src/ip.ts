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
