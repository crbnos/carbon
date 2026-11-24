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

  it("flags the stock transfer search that cfd5b2f781 quoted", () => {
    // apps/erp/app/modules/inventory/inventory.service.ts before cfd5b2f781.
    expect(
      scan(`  if (args.search) {
    query = query.or(
      \`transferId.ilike.%\${args.search}%,reference.ilike.%\${args.search}%\`
    );
  }`).map((v) => v.snippet)
    ).toEqual(["query = query.or("]);
  });

  it("passes the stock transfer search as cfd5b2f781 fixed it", () => {
    expect(
      scan(
        'query = query.or(searchFilter(["transferId", "reference"], args.search));'
      )
    ).toHaveLength(0);
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
