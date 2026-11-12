// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentTextCatalog } from "./types";

/**
 * A tracking label has no extra texts: its field names (Rev, Qty, S/N, Batch)
 * live on the label blocks' own `label`, which the PDF and the ZPL both read.
 */
export const trackingLabelTexts = {
  document: []
} as const satisfies DocumentTextCatalog;
