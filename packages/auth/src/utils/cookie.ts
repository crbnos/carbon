// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
