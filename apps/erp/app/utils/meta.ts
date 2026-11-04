// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Document title for a record page, e.g. "SO000001 | Sales Order | Carbon",
 * so the browser tab (and anything reading the page) names the open record.
 * Falls back to "Carbon | Sales Order" while the record is missing (loader
 * error, redirect, not yet loaded). Safe to call from `meta` — never throws.
 */
export function recordMeta(
  recordId: string | null | undefined,
  recordType: string
) {
  const id = typeof recordId === "string" ? recordId.trim() : "";
  return [
    { title: id ? `${id} | ${recordType} | Carbon` : `Carbon | ${recordType}` }
  ];
}
