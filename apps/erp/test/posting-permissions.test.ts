// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { levelReaches, pageById } from "@carbon/database/access";
import { describe, expect, it } from "vitest";

// A permission is `{ "<page>": "<Level>" }`: each key a page of the registry.
const LEVELS = new Set(["View", "Create", "Edit", "Full"]);

// These admit any member of the company. Widening who may run a posting is a
// review decision: add an entry only after one.
const OPEN_TO_ANY_MEMBER = [
  "inventory.issueMaterialPermission.jobCompleteMakeToOrder",
  "inventory.postPickingPermission",
  "inventory.postStockTransferPermission"
];

/** Each permission a rule can resolve to, named `<file>.<export>[.<value>]`. */
function leaves(name: string, rule: unknown): [string, unknown][] {
  if (rule && typeof rule === "object" && "by" in rule && "rules" in rule) {
    return Object.entries(rule.rules as Record<string, unknown>).map(
      ([value, leaf]) => [`${name}.${value}`, leaf]
    );
  }
  return [[name, rule]];
}

async function permissionExports() {
  const modules = import.meta.glob<Record<string, unknown>>(
    "../app/modules/*/*.service.ts"
  );
  const out: [string, unknown][] = [];
  for (const [path, load] of Object.entries(modules)) {
    const file = path.split("/").pop()?.replace(/\.service\.ts$/, "");
    for (const [name, rule] of Object.entries(await load())) {
      if (name.endsWith("Permission")) out.push(...leaves(`${file}.${name}`, rule));
    }
  }
  return out;
}

describe("posting permissions", () => {
  it("each requires a named module, is system-only, or is reviewed as open", async () => {
    const all = await permissionExports();
    const open = all
      .filter(
        ([, rule]) =>
          rule !== "system" &&
          Object.keys((rule ?? {}) as object).length === 0
      )
      .map(([name]) => name)
      .sort();
    expect(open).toEqual(OPEN_TO_ANY_MEMBER);
  }, 120_000);

  it("names only pages and levels that exist, so no claim can satisfy a typo", async () => {
    const unknown = (await permissionExports()).flatMap(([name, rule]) =>
      // A row rule picks its page from the row at run time (`rowRule`, `itemRule`).
      rule === "system" ||
      rule === "employee" ||
      (typeof rule === "object" && rule !== null && "row" in rule)
        ? []
        : Object.entries(rule as Record<string, string>)
            .filter(([page, level]) => !pageById(page) || !LEVELS.has(level))
            .map(([page, level]) => `${name}: ${page} ${level}`)
    );
    expect(unknown).toEqual([]);
  }, 120_000);

  // The rule's type needs a row for every conversion, including those that run as
  // the system (quote → order, RFQ → quote, warehouse transfers).
  it("a conversion needs Create on the page of the document it makes", async () => {
    const { convertDocumentPermission } = await import(
      "../app/modules/shared/shared.service"
    );
    const made: Record<string, string> = {
      purchaseOrderToPurchaseInvoice: "invoicing.purchaseInvoices",
      quoteToSalesOrder: "sales.salesOrders",
      salesOrderToSalesInvoice: "invoicing.salesInvoices",
      salesRfqToQuote: "sales.quotes",
      shipmentToSalesInvoice: "invoicing.salesInvoices",
      supplierQuoteToPurchaseOrder: "purchasing.purchaseOrders",
      warehouseTransferToShipment: "inventory.shipments",
      warehouseTransferToReceipt: "inventory.receipts"
    };
    const rules = convertDocumentPermission.rules as Record<
      string,
      Record<string, "View" | "Create" | "Edit" | "Full">
    >;
    // A new conversion gets a row here; activating a method makes nothing.
    expect(Object.keys(rules).sort()).toEqual(
      [...Object.keys(made), "methodVersionToActive"].sort()
    );
    const missing = Object.entries(made)
      .filter(([type, page]) => {
        const level = rules[type]?.[page];
        return !level || !levelReaches(level, "Create");
      })
      .map(([type, page]) => `${type}: ${page}`);
    expect(missing).toEqual([]);
  }, 120_000);
});
