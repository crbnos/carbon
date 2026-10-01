// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
 * `X-Forwarded-For` is a chain each proxy APPENDS to, so only its LAST entry —
 * the address the proxy in front of the app saw — cannot be forged: the ALB
 * appends to whatever the caller sent, and a first-entry read there hands the
 * caller any rate-limit bucket or audit-log address it likes. Vercel and Caddy
 * write a single entry, which is the same address.
 */
export function getClientIp(input: RequestLike): string | null {
  return listOf(headersOf(input).get("x-forwarded-for")).at(-1) ?? null;
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
