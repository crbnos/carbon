// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { gateConstants, listGates } from "./page-gates";

const GATE_ROUTES = "apps/erp/app/routes/x+/";

describe("gateConstants", () => {
  it("collects exported upper-case constants that name pages, outside routes", () => {
    const constants = gateConstants([
      {
        file: "apps/erp/app/modules/sales/sales.models.ts",
        contents: `export const CONTRACT_READ_GATE = anyOf(["sales.serviceContracts", "sales.projectContracts"], "View");\nexport const LIMIT = 10;\nconst HIDDEN = { "parts.parts": "View" };`
      },
      {
        file: `${GATE_ROUTES}contract+/$id.tsx`,
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
