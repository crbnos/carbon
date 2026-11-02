// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";
import { parseAcceptLanguage } from "intl-parse-accept-language";

type OperatingSystemPlatform = "mac" | "windows";

// ── What the proxy in front of the app tells us ─────────────────────────────
// Every deployment runs one proxy in front of the app: Vercel (Cloud), the AWS
// ALB (SST / ITAR), Caddy (self-host), portless (dev). `request.url` is the
// address the app was reached on BEHIND that proxy (an internal host, `http:`),
// so client and public-URL facts come from the forwarding headers — through
// these helpers only (`no-raw-forwarded-headers` in @carbon/checks).

/** A `Request`, or just its headers (plus its url, when there is one). */
type RequestLike = { headers: Pick<Headers, "get">; url?: string };

const headersOf = (input: RequestLike) => input.headers;
const urlOf = (input: RequestLike) => (input.url ? new URL(input.url) : null);

const listOf = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * The client's IP address, or null when no proxy reported one.
 *
 * `X-Forwarded-For` is a chain each proxy APPENDS to, so only the entries our
 * own proxies wrote — the last ones — cannot be forged: the ALB appends to
 * whatever the caller sent, and a first-entry read there hands the caller any
 * rate-limit bucket or audit-log address it likes. With one proxy in front of
 * the app (Vercel, the ALB, Caddy) the client is the last entry.
 *
 * `TRUSTED_PROXIES` counts the proxies when there are more. Behind an ALB and
 * then Traefik the chain arrives as `client, alb`, and the last entry is the
 * ALB's own address — every user one rate-limit bucket. With 2 the client is
 * the second from the end. A chain shorter than that came from fewer proxies
 * than promised, and its first entry is the client.
 */
export function getClientIp(input: RequestLike): string | null {
  const chain = listOf(headersOf(input).get("x-forwarded-for"));
  return chain.at(-trustedProxies()) ?? chain[0] ?? null;
}

// Read here rather than through @carbon/env, which depends on this package.
// Declared in packages/env/src/schema.ts like every other variable.
function trustedProxies(): number {
  const raw =
    typeof process === "undefined" ? undefined : process.env.TRUSTED_PROXIES;
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** `https` or `http` as the client used it: the proxy's, else `request.url`'s. */
export function getRequestProtocol(input: RequestLike): "http" | "https" {
  const forwarded = listOf(
    headersOf(input).get("x-forwarded-proto")
  )[0]?.toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  return urlOf(input)?.protocol === "https:" ? "https" : "http";
}

/**
 * The host the client addressed (`app.carbon.ms`, with a port if it has one).
 *
 * Fine for comparing with what the browser sent (`Origin`, `Referer`). NOT for
 * building a link someone else will open: the ALB passes a caller's own
 * `X-Forwarded-Host` through, so use `getAppUrl()` / `getMESUrl()` for those.
 */
export function getRequestHost(input: RequestLike): string | null {
  const headers = headersOf(input);
  return (
    listOf(headers.get("x-forwarded-host"))[0] ??
    headers.get("host") ??
    urlOf(input)?.host ??
    null
  );
}

/** `https://app.carbon.ms`: the origin the client addressed. Same caveat as the host. */
export function getRequestOrigin(input: RequestLike): string | null {
  const host = getRequestHost(input);
  return host ? `${getRequestProtocol(input)}://${host}` : null;
}

/**
 * The Referer header, reduced to a SAME-ORIGIN relative path (or null). Many
 * actions redirect back here — returning the raw header would let a crafted
 * request bounce the user to an attacker origin (CWE-601 open redirect), so a
 * cross-origin or unparsable referer yields null and callers fall back to
 * their fixed route.
 *
 * Compared with the origin the client addressed (`getRequestOrigin`), not
 * `request.url`'s: behind the proxy that is the internal scheme and host, which
 * never matches a real Referer.
 */
export function requestReferrer(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const origin = getRequestOrigin(request) ?? new URL(request.url).origin;
    const url = new URL(referer, origin);
    if (url.origin !== origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export const getPreferenceHeaders = (request: Request) => {
  const acceptLanguage = request.headers.get("accept-language");
  const cookieHeader = request.headers.get("cookie");
  const localeCookie = cookieHeader
    ? cookie.parse(cookieHeader).locale
    : undefined;
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf
  });
  const [cookieLocale] = localeCookie
    ? Intl.DateTimeFormat.supportedLocalesOf([localeCookie])
    : [];

  // get whether it's a mac or pc from the headers
  const platform: OperatingSystemPlatform = request.headers
    .get("user-agent")
    ?.includes("Mac")
    ? "mac"
    : "windows";

  let locale = cookieLocale ?? locales?.[0] ?? "en-US";

  if (cookieLocale && !cookieLocale.includes("-") && locales?.length) {
    const regionalMatch = locales.find((l) =>
      l.toLowerCase().startsWith(cookieLocale.toLowerCase() + "-")
    );
    if (regionalMatch) locale = regionalMatch;
  }

  return {
    platform,
    locale
  };
};
