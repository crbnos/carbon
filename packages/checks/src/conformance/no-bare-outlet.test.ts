// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findNestedOutlets, noBareOutlet } from "./no-bare-outlet";

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

describe("findNestedOutlets", () => {
  const TABLE = "apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx";
  const ROUTE = "apps/erp/app/routes/x+/settings+/api-keys.tsx";
  const file = (path: string, ...lines: string[]) => ({
    file: path,
    contents: `${lines.join("\n")}\n`
  });
  const table = file(TABLE, "<>", "  <Table />", "  <Outlet />", "</>");
  const where = (files: ReturnType<typeof file>[]) =>
    findNestedOutlets(files).map(({ file, line, snippet }) => ({
      file,
      line,
      snippet
    }));

  it("flags a route that renders its own outlet and a table that renders another", () => {
    const route = file(
      ROUTE,
      'import { ApiKeysTable } from "~/modules/settings/ui";',
      "<>",
      "  <ApiKeysTable data={data} />",
      "  <RecordOutlet />",
      "</>"
    );
    expect(where([table, route])).toEqual([
      { file: ROUTE, line: 3, snippet: "<ApiKeysTable data={data} />" }
    ]);
  });

  it("follows a component that renders the table", () => {
    const overlay = file(
      "apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysUpgradeOverlay.tsx",
      'import ApiKeysTable from "./ApiKeysTable";',
      "<ApiKeysTable data={mock} />"
    );
    const route = file(
      ROUTE,
      'import ApiKeysUpgradeOverlay from "~/modules/settings/ui/ApiKeys/ApiKeysUpgradeOverlay";',
      "if (gated) return <ApiKeysUpgradeOverlay />;",
      "<RecordOutlet />"
    );
    expect(where([table, overlay, route])).toEqual([
      {
        file: ROUTE,
        line: 2,
        snippet: "if (gated) return <ApiKeysUpgradeOverlay />;"
      }
    ]);
  });

  it("accepts a single outlet, in the route or in the table", () => {
    const imports =
      'import ApiKeysTable from "~/modules/settings/ui/ApiKeys/ApiKeysTable";';
    expect(
      where([
        file(TABLE, "<Table />"),
        file(ROUTE, imports, "<ApiKeysTable />", "<RecordOutlet />")
      ])
    ).toEqual([]);
    expect(where([table, file(ROUTE, imports, "<ApiKeysTable />")])).toEqual(
      []
    );
  });

  it("does not take another file's component of the same name for the table", () => {
    const itemSupplierParts = file(
      "apps/erp/app/modules/items/ui/Item/SupplierParts/SupplierParts.tsx",
      "<Grid />",
      "<Outlet />"
    );
    const route = file(
      "apps/erp/app/routes/x+/supplier+/$supplierId.parts.tsx",
      'import SupplierParts from "~/modules/purchasing/ui/Supplier/SupplierParts";',
      "<SupplierParts />",
      "<RecordOutlet />"
    );
    expect(where([itemSupplierParts, route])).toEqual([]);
  });

  it("follows a default import through a folder's index", () => {
    const panel = file(
      "apps/erp/app/components/Panel/Panel.tsx",
      "<Card />",
      "<Outlet />"
    );
    const route = file(
      ROUTE,
      'import Panel from "~/components/Panel";',
      "<Panel />",
      "<RecordOutlet />"
    );
    expect(where([panel, route])).toEqual([
      { file: ROUTE, line: 2, snippet: "<Panel />" }
    ]);
  });

  it("ignores type arguments and comments", () => {
    const route = file(
      ROUTE,
      'import { ApiKeysTable } from "~/modules/settings/ui";',
      "useColumns<ApiKeysTable>();",
      "// <ApiKeysTable /> renders the list",
      "<RecordOutlet />"
    );
    expect(where([table, route])).toEqual([]);
  });
});
