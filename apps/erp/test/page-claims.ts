// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type ExpandedClaims, moduleOf, PAGES } from "@carbon/database/access";

/**
 * Claims written per module, as a module grant resolves them: every page of
 * the module holds the module's actions. A key that is already a page, or
 * names no module, is kept as it is.
 */
export function pageClaims(claims: ExpandedClaims): ExpandedClaims {
  const out: ExpandedClaims = {};
  for (const [key, permission] of Object.entries(claims)) {
    const pages = PAGES.filter((page) => moduleOf(page.id) === key);
    if (!pages.length || pages.some((page) => page.id === key)) {
      out[key] = permission;
      continue;
    }
    for (const page of pages) out[page.id] ??= permission;
  }
  return out;
}
