// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  gateConstants,
  listGates,
  routeGateNamesPage
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

  it.each([
    `{ anyOf: morePages, "inventory.storageRules": "Create" }`,
    `{ ...sharedGate, "inventory.storageRules": "Create" }`,
    `anyOf(["inventory.storageRules", morePage], "Create")`
  ])("skips a gate that is only partly readable: %s", (gate) => {
    expect(scan("resources+/work-centers.new.tsx", gated(gate))).toEqual([]);
  });

  it("reads the pages a gate spreads from a constant", () => {
    const violations = scan(
      "part+/$itemId.tsx",
      gated(`{ ...CONTRACT_READ_GATE }`)
    );
    expect(violations.map((v) => v.line)).toEqual([2]);
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
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "projects.approvals": "View" }`)
      )
    ).toEqual([]);
    expect(
      scan(
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "sales.quotes": "View" }`)
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

  it("reads a list beside imports and functions", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `import { searchList } from "./search-list";
export function describeGate() {
  return "gate: none";
}
export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" } });`
      }
    ]);
    expect([...lists]).toEqual([["receiptsList", ["inventory.receipts"]]]);
  });

  it("reads a list beside constants that are not list definitions", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `const PAGE_SIZE = 50;
const paging = defaultPaging();
export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" } });`
      }
    ]);
    expect([...lists]).toEqual([["receiptsList", ["inventory.receipts"]]]);
  });
});
