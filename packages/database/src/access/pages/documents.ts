// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

/** All, My, Recent, Pinned and Trash are filters of one list: one page. */
export const DOCUMENTS_PAGES = [
  {
    id: "documents",
    label: "Documents",
    maxLevel: "Full",
    tables: ["document"],
    paths: ["/x/documents"]
  }
] as const satisfies readonly Page[];
