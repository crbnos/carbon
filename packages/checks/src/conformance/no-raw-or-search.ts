// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// Text interpolated into a PostgREST `.or()` filter is parsed as filter
// syntax: a search for "a,b" ended the filter at the comma and the request
// failed with PGRST100. `searchFilter` (`@carbon/utils`) quotes the term.
const RAW_OR_SEARCH = /\.or\(\s*`[^`]*\.ilike\.%?\$\{/g;

export const noRawOrSearch: ConformanceCheck = {
  id: "no-raw-or-search",
  description:
    "Search text goes into an .or() filter through searchFilter, which quotes it",
  provenance: {
    deprecates: ".or(`name.ilike.%${search}%,…`)",
    replacedBy: '.or(searchFilter(["name", …], search)) from "@carbon/utils"',
    since: "2026-10-19"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const match of contents.matchAll(RAW_OR_SEARCH)) {
      const line = contents.slice(0, match.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message:
          'Use `.or(searchFilter([...columns], term))` from "@carbon/utils": interpolated text is parsed as filter syntax, so a comma breaks the request'
      });
    }
    return violations;
  }
};
