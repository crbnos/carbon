// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AUTH_COOKIE_SUFFIX } from "../config/env";

/**
 * Auth cookies are set on DOMAIN so the ERP and MES share them. US and EU both
 * use carbon.ms, so EU suffixes its names: with the same name, each region
 * overwrote the other's cookie and failed its signature, signing the user out.
 */
export function authCookieName(name: string, suffix = AUTH_COOKIE_SUFFIX) {
  return suffix ? `${name}-${suffix}` : name;
}

export function getCookieDomain(
  domain: string | null | undefined
): string | undefined {
  if (!domain) return undefined;

  const withoutProtocol = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  const host = withoutProtocol.split("/")[0]?.split(":")[0];

  if (!host) return undefined;
  if (host === "localhost" || host.endsWith(".localhost")) return undefined;
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return undefined;

  return host;
}
