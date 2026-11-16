// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentTextCatalog } from "./types";

/**
 * A Certificate of Conformance prints the numbered fields of the AS9163
 * layout, and its blocks hold those names themselves, so it has no editable
 * texts yet.
 */
export const certificateOfConformanceTexts = {
  document: []
} as const satisfies DocumentTextCatalog;
