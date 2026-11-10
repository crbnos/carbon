// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { anyOf, type Gate, pagesOf } from "@carbon/database/access";

/**
 * What the item tabs that show another module's data need, beside View on the
 * item's own page, for the five item types: View on any page of that module.
 * Accounting shows with View on any Purchasing page.
 */
export const ITEM_TAB_GATES = {
  purchasing: anyOf(pagesOf("purchasing"), "View"),
  accounting: anyOf(pagesOf("purchasing"), "View"),
  quality: anyOf(pagesOf("quality"), "View")
} as const satisfies Record<string, Gate>;
