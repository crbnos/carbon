// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noRawOrSearch } from "./no-raw-or-search";

const scan = (contents: string) => noRawOrSearch.scan("a.service.ts", contents);

describe("no-raw-or-search", () => {
  it("flags search text interpolated into an .or() ilike", () => {
    expect(
      scan(
        "query.or(\n  `name.ilike.%${args.search}%,id.ilike.%${args.search}%`\n);"
      )
    ).toHaveLength(1);
    expect(scan("query.or(`id.ilike.${pattern}`);")).toHaveLength(1);
  });

  it("passes searchFilter and .or() filters on ids the code built", () => {
    expect(scan('query.or(searchFilter(["name"], args.search));')).toHaveLength(
      0
    );
    expect(
      scan("query.or(`companyId.eq.${companyId},companyId.is.null`);")
    ).toHaveLength(0);
  });
});
