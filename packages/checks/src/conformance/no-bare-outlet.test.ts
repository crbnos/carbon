// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noBareOutlet } from "./no-bare-outlet";

const scan = (
  contents: string,
  file = "apps/erp/app/routes/x+/part+/$itemId.tsx"
) => noBareOutlet.scan(file, contents);

describe("noBareOutlet", () => {
  it("flags a plain outlet in a route under /x, in either app", () => {
    expect(scan("  return <Outlet />;\n")).toHaveLength(1);
    expect(
      scan(
        "<div>\n  <Outlet context={ctx} />\n</div>\n",
        "apps/mes/app/routes/x+/picking.tsx"
      )[0]!.line
    ).toBe(2);
  });

  it("accepts the record outlet, a keyed outlet and a mention in a comment", () => {
    expect(scan("  return <RecordOutlet />;\n")).toEqual([]);
    expect(scan("  <Outlet key={companyId} />\n")).toEqual([]);
    expect(
      scan("  // No <Outlet /> here: the detail is a full page\n")
    ).toEqual([]);
  });

  it("leaves routes outside /x and components alone", () => {
    expect(
      scan("<Outlet />", "apps/erp/app/routes/_public+/_layout.tsx")
    ).toEqual([]);
    expect(
      scan("<Outlet />", "apps/erp/app/modules/items/ui/Item/SupplierParts.tsx")
    ).toEqual([]);
  });
});
