// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  gateConstants,
  listGates,
  routeGateNamesPage,
  routeUrl
} from "./route-gate-names-page";

const ROUTES = "apps/erp/app/routes/x+/";
const check = routeGateNamesPage(
  new Map([["CONTRACT_READ_GATE", ["sales.serviceContracts"]]]),
  new Map([["receiptsList", ["inventory.receipts"]]])
);
const scan = (route: string, contents: string) =>
  check.scan(`${ROUTES}${route}`, contents);
const gated = (gate: string) =>
  `export async function loader({ request }) {\n  await authorize(request, ${gate});\n}\n`;

describe("routeUrl", () => {
  it("drops layout and index segments and splits on dots", () => {
    expect(routeUrl("part+/$itemId.sales.rental-rates.new.tsx")).toBe(
      "/x/part/$itemId/sales/rental-rates/new"
    );
    expect(routeUrl("inventory+/_index.tsx")).toBe("/x/inventory");
  });
});

describe("routeGateNamesPage", () => {
  it("accepts a gate on the page the URL maps to", () => {
    expect(
      scan("inventory+/receipts.tsx", gated(`{ "inventory.receipts": "View" }`))
    ).toEqual([]);
  });

  it("flags a gate on another page", () => {
    const [violation, ...rest] = scan(
      "resources+/work-centers.new.tsx",
      gated(`{ "inventory.storageRules": "Create" }`)
    );
    expect(rest).toEqual([]);
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("resources.workCenters");
  });

  it("accepts a list that holds the page, by anyOf, pagesOf or ITEM_PAGES", () => {
    expect(
      scan("part+/$itemId.tsx", gated(`anyOf(ITEM_PAGES, "View")`))
    ).toEqual([]);
    expect(
      scan(
        "inventory+/receipts.tsx",
        gated(`anyOf(pagesOf("inventory"), "View")`)
      )
    ).toEqual([]);
    expect(
      scan(
        "inventory+/receipts.tsx",
        gated(`anyOf(["parts.parts", "inventory.receipts"], "View")`)
      )
    ).toEqual([]);
  });

  it("reads a gate constant by name", () => {
    expect(scan("contract+/$id.tsx", gated("CONTRACT_READ_GATE"))).toEqual([]);
    expect(scan("part+/$itemId.tsx", gated("CONTRACT_READ_GATE"))).toHaveLength(
      1
    );
  });

  it("skips a gate it cannot read, a gate-less authorize and an unmapped URL", () => {
    expect(
      scan("inventory+/receipts.tsx", gated("permissionsFor(type)"))
    ).toEqual([]);
    expect(
      scan(
        "inventory+/receipts.tsx",
        "const { api } = await authorize(request);"
      )
    ).toEqual([]);
    expect(
      scan("account+/profile.tsx", gated(`{ "parts.parts": "View" }`))
    ).toEqual([]);
  });

  it("reads the gate of the list a route loads with loadListPage", () => {
    const loads = (list: string) =>
      `export async function loader({ request }) {\n  return loadListPage(request, ${list}, { dataKey: "rows" });\n}\n`;
    expect(scan("inventory+/receipts.tsx", loads("receiptsList"))).toEqual([]);
    const [violation] = scan("inventory+/shipments.tsx", loads("receiptsList"));
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("inventory.shipments");
    expect(scan("inventory+/shipments.tsx", loads("unknownList"))).toEqual([]);
  });

  it("accepts the pages an exception lists for its route", () => {
    expect(
      scan(
        "resources+/work-centers.rules.assign.$workCenterId.tsx",
        gated(`{ "inventory.storageRules": "Create" }`)
      )
    ).toEqual([]);
    expect(
      scan(
        "resources+/work-centers.rules.assign.$workCenterId.tsx",
        gated(`{ "sales.quotes": "Create" }`)
      )
    ).toHaveLength(1);
  });
});

describe("gateConstants", () => {
  it("collects exported upper-case constants that name pages, outside routes", () => {
    const constants = gateConstants([
      {
        file: "apps/erp/app/modules/sales/sales.models.ts",
        contents: `export const CONTRACT_READ_GATE = anyOf(["sales.serviceContracts", "sales.projectContracts"], "View");\nexport const LIMIT = 10;\nconst HIDDEN = { "parts.parts": "View" };`
      },
      {
        file: `${ROUTES}contract+/$id.tsx`,
        contents: `export const ROUTE_GATE = { "parts.parts": "View" };`
      }
    ]);
    expect([...constants]).toEqual([
      [
        "CONTRACT_READ_GATE",
        ["sales.serviceContracts", "sales.projectContracts"]
      ]
    ]);
  });
});

describe("listGates", () => {
  it("collects the gate of each list, from searchList or an object", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" }, paging });
export const paymentsList = { key: "payments", gate: { "invoicing.payments": "View" }, query } satisfies ListDefinition;
export const itemsList = searchList({ key: "items", gate: anyOf(ITEM_PAGES, "View") });
export const lists = { receipts: receiptsList };`
      }
    ]);
    expect(lists.get("receiptsList")).toEqual(["inventory.receipts"]);
    expect(lists.get("paymentsList")).toEqual(["invoicing.payments"]);
    expect(lists.get("itemsList")).toContain("parts.parts");
    expect(lists.has("lists")).toBe(false);
  });
});
