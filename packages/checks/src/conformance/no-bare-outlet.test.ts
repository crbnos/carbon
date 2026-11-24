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

  it("flags the supplier route's plain outlet that f18c5dad02 made a RecordOutlet", () => {
    // apps/erp/app/routes/x+/supplier+/$supplierId.tsx before f18c5dad02:
    // moving to another supplier kept the page mounted, so its tax form held
    // the first supplier's id.
    const route = [
      "export default function SupplierRoute() {",
      "  return (",
      "    <>",
      "      <SupplierHeader />",
      '      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">',
      "        <SupplierSidebar />",
      "        <Outlet />",
      "      </div>",
      "    </>",
      "  );",
      "}"
    ].join("\n");
    const file = "apps/erp/app/routes/x+/supplier+/$supplierId.tsx";
    expect(scan(route, file).map((v) => v.line)).toEqual([7]);
    expect(scan(route.replace("<Outlet />", "<RecordOutlet />"), file)).toEqual(
      []
    );
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

  it("does not take another export of the component's file for the component", () => {
    const panel = file(
      "apps/erp/app/components/Panel/Panel.tsx",
      "export const PanelHeader = () => <h2 />;",
      "export default function Panel() { return <Outlet />; }"
    );
    const route = file(
      ROUTE,
      'import { PanelHeader } from "~/components/Panel/Panel";',
      "<PanelHeader />",
      "<RecordOutlet />"
    );
    expect(where([panel, route])).toEqual([]);
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

  it("flags the API keys route whose table kept an outlet until 5a0ea7c0d2", () => {
    // apps/erp/app/routes/x+/settings+/api-keys.tsx and ApiKeysTable.tsx
    // before 5a0ea7c0d2: New API Key opened two modals with the same input ids.
    const before = file(
      TABLE,
      'import { Outlet, useNavigate } from "react-router";',
      "const ApiKeysTable = memo((props: ApiKeysTableProps) => {",
      "  return (",
      "    <>",
      "      <Table<ApiKeyRow>",
      "        title={t`API Keys`}",
      "      />",
      "      <Outlet />",
      "    </>",
      "  );",
      "});",
      "export default ApiKeysTable;"
    );
    const route = file(
      ROUTE,
      'import { RecordOutlet } from "@carbon/react";',
      'import { ApiKeysTable, ApiKeysUpgradeOverlay } from "~/modules/settings/ui";',
      "  return (",
      "    <>",
      "      <ApiKeysTable count={count} data={apiKeys} infinite={infinite} />",
      "      <RecordOutlet />",
      "    </>",
      "  );"
    );
    expect(where([before, route])).toEqual([
      {
        file: ROUTE,
        line: 5,
        snippet:
          "<ApiKeysTable count={count} data={apiKeys} infinite={infinite} />"
      }
    ]);
    const after = file(
      TABLE,
      ...before.contents
        .trimEnd()
        .split("\n")
        .filter((line) => !line.includes("<Outlet />"))
    );
    expect(where([after, route])).toEqual([]);
  });
});
