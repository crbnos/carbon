// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TextEntry } from "./types";

/** The words around the page number in the footer of every full-page document. */
export const FOOTER_TEXTS = [
  { key: "page", kind: "text", default: "Page" },
  { key: "of", kind: "text", default: "of" }
] as const satisfies readonly TextEntry[];
