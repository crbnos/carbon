// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { typescript } from "../../sources/inputs";

// Text interpolated into a PostgREST `.or()` filter is parsed as filter
// syntax: a search for "a,b" ended the filter at the comma and the request
// failed with PGRST100. `searchFilter` (`@carbon/utils`) quotes the term.
export const noRawOrSearch = defineCheck({
  files: typescript,
  id: "no-raw-or-search",
  description:
    "Search text goes into an .or() filter through searchFilter, which quotes it",
  provenance: {
    deprecates: ".or(`name.ilike.%${search}%,…`)",
    replacedBy: '.or(searchFilter(["name", …], search)) from "@carbon/utils"',
    since: "2026-10-19"
  },
  within: "file",
  snippet: "trimmed-line",
  banned: [
    {
      pattern: /\.or\(\s*`[^`]*\.ilike\.%?\$\{/g,
      message:
        'Use `.or(searchFilter([...columns], term))` from "@carbon/utils": interpolated text is parsed as filter syntax, so a comma breaks the request'
    }
  ]
});
