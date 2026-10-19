// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { searchFilter } from "./supabase";

describe("searchFilter", () => {
  it("quotes the term so filter syntax in it stays text", () => {
    expect(searchFilter(["name", "readableId"], 'a,b.(c) "d" \\')).toBe(
      'name.ilike."%a,b.(c) \\"d\\" \\\\%",readableId.ilike."%a,b.(c) \\"d\\" \\\\%"'
    );
  });
});
