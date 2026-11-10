// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Document title for an MES screen, e.g. "Schedule | Carbon MES", so the
 * browser tab (and anything reading the page) says which screen is open.
 */
export function pageMeta(page: string) {
  return [{ title: `${page} | Carbon MES` }];
}

/**
 * Document title for a record screen, e.g. "J000123 · Laser Cut | Operation |
 * Carbon MES". The parts that are present are joined with " · " to name the
 * record; with none the title falls back to "Operation | Carbon MES" (loader
 * error, redirect, not yet loaded). Safe to call from `meta` — never throws.
 */
export function recordMeta(
  recordParts: string | null | undefined | Array<string | null | undefined>,
  recordType: string
) {
  const parts = Array.isArray(recordParts) ? recordParts : [recordParts];
  const name = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" · ");
  return [
    {
      title: name
        ? `${name} | ${recordType} | Carbon MES`
        : `${recordType} | Carbon MES`
    }
  ];
}
