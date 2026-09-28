import { describe, expect, it } from "vitest";
import { getDbRelations } from "../../../scripts/lib/db-types";
import {
  deriveIdentifierContract,
  type IdentifierFinding,
  idKeyedTables,
  listRowKeyFinding,
  paramFilters
} from "../../../scripts/lib/identifier-contract";
import {
  buildAllToolMetadata,
  type OperationSource
} from "../../../scripts/lib/service-metadata";
import { IDENTIFIER_KEYS } from "../app/routes/api+/mcp+/lib/identifier-keys";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Guards the identifier contract (`mcp+/lib/identifier-keys.ts`): a param that
// keys an entity takes the record id and is resolved from the readable number
// by the dispatcher; a list read returns the key its table's keyed tools take.
// Before it, `production_deleteJob {jobId: "J000123"}` deleted nothing and
// reported success, and `sales_getSalesOrderLines` returned [] for the
// `salesOrderId` value the order list itself hands out.

type Tool = {
  name: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  schema: { properties?: Record<string, { description?: string }> };
  keys?: Record<string, string>;
  responseSchema?: {
    type?: string;
    items?: { properties?: Record<string, unknown> };
  };
};

const tools = metadata.tools as Tool[];
const byName = new Map(tools.map((t) => [t.name, t]));

const findings: IdentifierFinding[] = [];
const sources: OperationSource[] = [];
const textual = buildAllToolMetadata({
  onIdentifierFinding: (f) => findings.push(f),
  onOperationSource: (s) => sources.push(s)
});

/**
 * List reads whose rows are reviewed projections or aggregates, not records a
 * caller goes on to address by id. Each reason names what the rows are.
 */
const LIST_KEY_EXEMPT: Record<string, string> = {
  invoicing_getStagedCreditsForPayment:
    "memo-to-invoice amounts staged on a payment, summed per invoice",
  items_getTopLevelProductsForItems:
    "top-level products reached through the BOM, computed per source item",
  production_getJobMaterialItemIds: "the distinct item ids of a job's materials",
  production_getActiveEmployeeAbilities:
    "who is qualified for what, for the people board; abilities are managed per employee",
  production_getFlattenedBomMaterials:
    "an exploded BOM computed from make methods",
  production_getJobMaterialPurchaseOrderLines:
    "open purchase quantities per item for the order-status badge",
  production_getJobMaterialSupplyJobLines:
    "supply-job status per item for the order-status badge",
  quality_getIssueSuppliers:
    "the suppliers linked to an issue, for its header; associations are read with getIssueAssociations",
  sales_getSalesOrderInvoiceLines: "the invoice ids a sales order was billed on"
};

describe("identifier contract: keyed params", () => {
  it("every param named after a readable column is covered", () => {
    const problems = findings.filter((f) => f.kind !== "list-omits-key");
    expect(
      problems.map((f) => `${f.tool} (${f.kind}): ${f.detail}`)
    ).toEqual([]);
  });

  it("the generated manifest carries the keys the sources declare", () => {
    const fresh = new Map(textual.map((t) => [t.name, t.keys]));
    for (const tool of tools) {
      expect(tool.keys, tool.name).toEqual(fresh.get(tool.name));
    }
  });

  it("every keyed param publishes which key it takes", () => {
    for (const tool of tools) {
      for (const param of Object.keys(tool.keys ?? {})) {
        expect(
          tool.schema.properties?.[param]?.description,
          `${tool.name}.${param}`
        ).toMatch(/record id \(the `id` field/);
      }
    }
  });

  it.each([
    ["sales_getSalesOrderLines", { salesOrderId: "salesOrder" }],
    ["sales_getQuote", { quoteId: "quote" }],
    ["sales_deleteQuote", { quoteId: "quote" }],
    ["production_deleteJob", { jobId: "job" }],
    ["items_getSupplierParts", { itemId: "item" }],
    ["items_deleteItem", { id: "item" }],
    ["production_getJob", { id: "job" }],
    ["sales_getSalesReturnOrder", { salesReturnOrderId: "salesReturnOrder" }],
    ["purchasing_deletePurchaseOrder", { purchaseOrderId: "purchaseOrder" }],
    ["inventory_deleteWarehouseTransfer", { transferId: "warehouseTransfer" }],
    [
      "invoicing_updateSalesInvoiceLineOrder",
      { invoiceId: "salesInvoice" }
    ]
  ])("%s resolves its key", (name, keys) => {
    expect(byName.get(name)?.keys).toEqual(keys);
  });

  it("a param named for a foreign key is not the row id", () => {
    // These deletes take the join row's own id; the param used to be named
    // after the item / work center column the row also carries.
    for (const name of [
      "resources_deleteMaintenanceDispatchItem",
      "resources_deleteMaintenanceDispatchWorkCenter",
      "resources_deleteMaintenanceScheduleItem",
      "production_deleteMaintenanceDispatchItem",
      "production_deleteMaintenanceDispatchWorkCenter",
      "production_deleteMaintenanceScheduleItem"
    ]) {
      const tool = byName.get(name);
      expect(Object.keys(tool?.schema.properties ?? {}), name).toEqual(["id"]);
      expect(tool?.keys, name).toBeUndefined();
    }
  });

  it("every key names a company-scoped table with its readable columns", () => {
    const relations = getDbRelations();
    for (const [entity, key] of Object.entries(IDENTIFIER_KEYS)) {
      const columns = relations.get(key.table)?.columns ?? [];
      expect(columns, entity).toContain("id");
      expect(columns, entity).toContain("companyId");
      for (const column of key.readable) {
        expect(columns, `${entity}.${column}`).toContain(column);
      }
    }
  });
});

describe("identifier contract: list rows", () => {
  const keyedTables = idKeyedTables(sources);
  const sourceByName = new Map(sources.map((s) => [s.name, s]));
  const listFindings = tools.flatMap((tool) => {
    const rows = tool.responseSchema;
    if (tool.classification !== "READ" || rows?.type !== "array") return [];
    const properties = rows.items?.properties;
    const source = sourceByName.get(tool.name);
    if (!properties || !source) return [];
    const finding = listRowKeyFinding(
      tool.name,
      source.body,
      Object.keys(properties),
      keyedTables
    );
    return finding ? [finding] : [];
  });

  it("list rows carry the id their table's keyed tools take", () => {
    expect(
      listFindings
        .filter((f) => !(f.tool in LIST_KEY_EXEMPT))
        .map((f) => `${f.tool}: ${f.detail}`)
    ).toEqual([]);
  });

  it("every exemption is still needed", () => {
    const hit = new Set(listFindings.map((f) => f.tool));
    expect(Object.keys(LIST_KEY_EXEMPT).filter((t) => !hit.has(t))).toEqual(
      []
    );
  });

  it("the unit-of-measure list returns the id its keyed tools take", () => {
    const rows = byName.get("items_getUnitOfMeasuresList")?.responseSchema;
    expect(Object.keys(rows?.items?.properties ?? {})).toEqual(
      expect.arrayContaining(["id", "code", "name"])
    );
  });
});

describe("identifier contract: source scan", () => {
  it("finds supabase and Kysely filters with their tables", () => {
    const body = `
      const a = await client.from("job").select("id").eq("id", jobId).single();
      const b = client.from("jobOperation").select("*").in("jobId", jobId);
      const c = db.selectFrom("job").where("job.companyId", "=", companyId)
        .where("id", "=", jobId);
      const d = client.from("productionEvent").eq("jobOperation.jobId", jobId);
      const e = client.from("job").eq("id", args.jobId);
    `;
    expect(paramFilters(body, "jobId")).toEqual([
      { table: "job", column: "id" },
      { table: "jobOperation", column: "jobId" },
      { table: "jobOperation", column: "jobId" },
      { table: "job", column: "id" }
    ]);
  });

  it("refuses a key the service compares against the readable column", () => {
    const { keys, findings } = deriveIdentifierContract(
      "production_getJobByNumber",
      [{ name: "jobId", typeStr: "string" }],
      `return client.from("jobs").select("*").eq("jobId", jobId).single();`
    );
    expect(keys).toEqual({});
    expect(findings.map((f) => f.kind)).toEqual(["readable-compared"]);
  });

  it("flags a param named for a column of the table whose id it filters", () => {
    const { findings } = deriveIdentifierContract(
      "resources_deleteThing",
      [{ name: "itemId", typeStr: "string" }],
      `return client.from("maintenanceDispatchItem").delete().eq("id", itemId);`
    );
    expect(findings.map((f) => f.kind)).toEqual(["fk-named-row-id"]);
  });

  it("flags an `id` param that is never compared against an id column", () => {
    const { findings } = deriveIdentifierContract(
      "items_getThings",
      [{ name: "id", typeStr: "string" }],
      `return client.from("supplierPart").select("*").eq("itemId", id);`
    );
    expect(findings.map((f) => f.kind)).toEqual(["id-names-other-column"]);
  });

  it("flags a readable-named param no key covers", () => {
    const { keys, findings } = deriveIdentifierContract(
      "invoicing_getThing",
      [{ name: "invoiceId", typeStr: "string" }],
      `return client.from("invoiceThing").select("*").eq("targetId", invoiceId);`
    );
    expect(keys).toEqual({});
    expect(findings.map((f) => f.kind)).toEqual(["unkeyed-readable-param"]);
  });

  it("keys an `id` param by the one entity table it filters", () => {
    expect(
      deriveIdentifierContract(
        "items_deleteThing",
        [{ name: "id", typeStr: "string" }],
        `return client.from("item").delete().eq("id", id);`
      ).keys
    ).toEqual({ id: "item" });
    // A table outside the contract, or two entities, keys nothing.
    expect(
      deriveIdentifierContract(
        "items_deleteThing",
        [{ name: "id", typeStr: "string" }],
        `return client.from("itemPostingGroup").delete().eq("id", id);`
      ).keys
    ).toEqual({});
  });

  it("keys a param by its entity name and describes it", () => {
    const { keys, descriptions, findings } = deriveIdentifierContract(
      "sales_getThing",
      [
        { name: "salesOrderId", typeStr: "string" },
        { name: "lines", typeStr: "string[]" }
      ],
      `return client.from("salesOrderLines").eq("salesOrderId", salesOrderId);`
    );
    expect(findings).toEqual([]);
    expect(keys).toEqual({ salesOrderId: "salesOrder" });
    expect(descriptions.salesOrderId).toContain("`salesOrderId`");
  });
});
