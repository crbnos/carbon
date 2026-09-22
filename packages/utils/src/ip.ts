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
  trustedProxyCount?: number;
  trustedProxyIps?: string[];
};

export function getClientIp(
  request: Request,
  options: ClientIpOptions = {}
): string | null {
  const { trustedProxyCount = 0, trustedProxyIps = [] } = options;

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

  return hops[Math.max(index, 0)] ?? null;
}

function stripPort(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1]!;
  const colons = trimmed.split(":").length - 1;
  if (colons === 1) return trimmed.split(":")[0]!;
  return trimmed;
}
