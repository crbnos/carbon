// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { routeGateNamesPage } from "./route-gate-names-page";

const GATE_ROUTES = "apps/erp/app/routes/x+/";

// A gate constant naming sales.serviceContracts, and a list gated on
// inventory.receipts.
const MODULES = [
  {
    file: "apps/erp/app/modules/sales/sales.models.ts",
    contents: `export const CONTRACT_READ_GATE = { "sales.serviceContracts": "View" };`
  }
];
const LISTS = [
  {
    file: "apps/erp/app/utils/list-registry/inventory.server.ts",
    contents: `export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" } });`
  }
];

const scanRoute = (route: string, contents: string) =>
  routeGateNamesPage.find({
    routes: [{ file: `${GATE_ROUTES}${route}`, contents }],
    modules: MODULES,
    lists: LISTS
  });
const gated = (gate: string) =>
  `export async function loader({ request }) {\n  await authorize(request, ${gate});\n}\n`;

describe("routeGateNamesPage", () => {
  it("accepts a gate on the page the URL maps to", () => {
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`{ "inventory.receipts": "View" }`)
      )
    ).toEqual([]);
  });

  it("flags a gate on another page", () => {
    const [violation, ...rest] = scanRoute(
      "resources+/work-centers.new.tsx",
      gated(`{ "inventory.storageRules": "Create" }`)
    );
    expect(rest).toEqual([]);
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("resources.workCenters");
  });

  it("accepts a list that holds the page, by anyOf, pagesOf or ITEM_PAGES", () => {
    expect(
      scanRoute("part+/$itemId.tsx", gated(`anyOf(ITEM_PAGES, "View")`))
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`anyOf(pagesOf("inventory"), "View")`)
      )
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`anyOf(["parts.parts", "inventory.receipts"], "View")`)
      )
    ).toEqual([]);
  });

  it("reads a gate constant by name", () => {
    expect(scanRoute("contract+/$id.tsx", gated("CONTRACT_READ_GATE"))).toEqual(
      []
    );
    expect(
      scanRoute("part+/$itemId.tsx", gated("CONTRACT_READ_GATE"))
    ).toHaveLength(1);
  });

  it("skips a gate it cannot read, a gate-less authorize and an unmapped URL", () => {
    expect(
      scanRoute("inventory+/receipts.tsx", gated("permissionsFor(type)"))
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        "const { api } = await authorize(request);"
      )
    ).toEqual([]);
    expect(
      scanRoute("account+/profile.tsx", gated(`{ "parts.parts": "View" }`))
    ).toEqual([]);
  });

  it.each([
    `{ anyOf: morePages, "inventory.storageRules": "Create" }`,
    `{ ...sharedGate, "inventory.storageRules": "Create" }`,
    `anyOf(["inventory.storageRules", morePage], "Create")`
  ])("skips a gate that is only partly readable: %s", (gate) => {
    expect(scanRoute("resources+/work-centers.new.tsx", gated(gate))).toEqual(
      []
    );
  });

  it("reads the pages a gate spreads from a constant", () => {
    const violations = scanRoute(
      "part+/$itemId.tsx",
      gated(`{ ...CONTRACT_READ_GATE }`)
    );
    expect(violations.map((v) => v.line)).toEqual([2]);
  });

  it("reads the gate of the list a route loads with loadListPage", () => {
    const loads = (list: string) =>
      `export async function loader({ request }) {\n  return loadListPage(request, ${list}, { dataKey: "rows" });\n}\n`;
    expect(scanRoute("inventory+/receipts.tsx", loads("receiptsList"))).toEqual(
      []
    );
    const [violation] = scanRoute(
      "inventory+/shipments.tsx",
      loads("receiptsList")
    );
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("inventory.shipments");
    expect(scanRoute("inventory+/shipments.tsx", loads("unknownList"))).toEqual(
      []
    );
  });

  it("accepts the pages an exception lists for its route", () => {
    expect(
      scanRoute(
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "projects.approvals": "View" }`)
      )
    ).toEqual([]);
    expect(
      scanRoute(
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "sales.quotes": "View" }`)
      )
    ).toHaveLength(1);
  });
});
