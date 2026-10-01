// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Entry dates are formatted from their YYYY-MM-DD parts, never through a JS
// Date, so every timezone sees the date the entry was written with.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-09-04" → "September 4, 2026". */
export function formatChangelogDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

// "2026-09-04" → "04 Sep 2026 00:00:00 GMT" (RFC 822, for RSS).
export function rfc822Date(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = String(d).padStart(2, "0");
  return `${day} ${MONTHS[(m ?? 1) - 1].slice(0, 3)} ${y} 00:00:00 GMT`;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const RSS_ITEM_LIMIT = 20;
