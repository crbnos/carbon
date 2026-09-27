// Guards the input schemas the MCP generator derives from the TypeScript
// checker (scripts/lib/param-schema.ts) against the classes of bug the textual
// parser shipped: a defaulted or `T | undefined` param published as required, a
// required null-only property, an untyped `{}` for a typed param, and list
// operations whose GenericQueryFilters param was nested, required, mis-typed or
// missing its filters/sorts.
import * as path from "path";
import { Project } from "ts-morph";
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifestEntry } from "@carbon/api";
import { MCP_DEFAULT_LIMIT } from "../../../packages/ee/src/mcp/format-result";
import {
  findCheckerDisagreements,
  findInputSchemaViolations
} from "../../../scripts/lib/input-schema-guards";
import {
  buildParamSchemaIndex,
  type CheckedParam,
  type ParamSchemaIndex
} from "../../../scripts/lib/param-schema";
import { MODULE_LIST } from "../../../scripts/lib/service-metadata";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

const tools = metadata.tools as unknown as ManifestEntry[];
const byName = new Map(tools.map((t) => [t.name, t]));
const get = (name: string) => {
  const tool = byName.get(name);
  if (!tool) throw new Error(`${name} missing from tool-metadata.json`);
  return tool;
};
const props = (name: string) =>
  (get(name).schema.properties ?? {}) as Record<string, any>;
const required = (name: string) =>
  (get(name).schema.required as string[] | undefined) ?? [];

describe("input schemas against the TypeScript checker (whole manifest)", () => {
  let index: ParamSchemaIndex;
  beforeAll(() => {
    index = buildParamSchemaIndex(MODULE_LIST);
  }, 180_000);

  it("has no input schema violations", () => {
    expect(findInputSchemaViolations(tools, index)).toEqual([]);
  });

  // Where the textual parser still resolves a param differently from the
  // checker. Not a failure: review the list when it changes, and empty it
  // before switching every schema to the checker.
  it("lists where the textual schema and the checker still disagree", async () => {
    await expect(
      `${findCheckerDisagreements(tools, index).join("\n")}\n`
    ).toMatchFileSnapshot("__snapshots__/mcp-checker-disagreements.txt");
  });

  it("reads the filter operators from getGenericFilter's switch", () => {
    expect(index.filterOperators).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "startsWith",
      "in"
    ]);
  });
});

describe("manifest pins for the reported tools", () => {
  it("a typed default is optional, typed, and publishes the default", () => {
    const p = props("production_getActiveJobOperationsByLocation");
    expect(p.workCenterIds).toMatchObject({
      type: "array",
      items: { type: "string" },
      default: []
    });
    expect(required("production_getActiveJobOperationsByLocation")).toEqual([
      "locationId"
    ]);

    for (const name of [
      "sales_getCustomerItemPriceOverride",
      "sales_getCustomerTypeItemPriceOverride",
      "sales_getAllCustomersItemPriceOverride"
    ]) {
      expect(props(name).quantity).toEqual({ type: "number", default: 1 });
      expect(required(name)).not.toContain("quantity");
    }
    for (const name of [
      "inventory_getItemLedgerPage",
      "production_getProductionEventsPage"
    ]) {
      expect(props(name).sortDescending).toEqual({
        type: "boolean",
        default: false
      });
      expect(props(name).page).toEqual({ type: "number", default: 1 });
      expect(required(name)).not.toContain("page");
    }
  });

  it("a null | undefined assignee is optional and documented", () => {
    for (const name of [
      "sales_updateQuoteStatus",
      "sales_updateSalesOrderStatus",
      "sales_updateSalesRFQStatus",
      "invoicing_updatePurchaseInvoiceStatus",
      "invoicing_updateSalesInvoiceStatus",
      "purchasing_updatePurchaseOrderStatus",
      "purchasing_updateSupplierQuoteStatus"
    ]) {
      expect(required(name)).not.toContain("assignee");
      expect(props(name).assignee.type).toBe("null");
      expect(props(name).assignee.description).toMatch(/Omit to keep/);
    }
  });

  it("a named type resolves instead of publishing {}", () => {
    expect(props("production_getJobDocumentsWithItemId").job).toMatchObject({
      type: "object",
      properties: { id: {}, salesOrderLineId: {}, quoteLineId: {} },
      required: ["id"]
    });
    expect(props("invoicing_getArAging").options).toMatchObject({
      type: "object",
      properties: {
        agingMethod: { enum: ["dueDate", "documentDate"] },
        bucketDays: { type: "array", minItems: 3, maxItems: 3 }
      },
      default: {}
    });
    expect(required("invoicing_getArAging")).toEqual(["asOfDate"]);
  });

  it("an @param tag documents a magic value", () => {
    expect(
      props("items_getItemStockQuantitiesByLocation").locationId.description
    ).toMatch(/"all"/);
  });

  it("a `{…} & GenericQueryFilters` param publishes its members, not one mis-typed field", () => {
    const p = props("production_getJobs");
    expect(p.search).toEqual({ type: ["string", "null"] });
    expect(p.limit).toMatchObject({ type: "integer", default: MCP_DEFAULT_LIMIT });
    expect(required("production_getJobs")).toEqual([]);
  });

  it("list operations publish flat, with nothing from GenericQueryFilters required", () => {
    for (const name of [
      "production_getJobOperations",
      "production_getJobOperationStepRecords",
      "production_getProductionPlanning",
      "sales_getExternalSalesOrderLines",
      "inventory_getInventoryItems",
      "inventory_getStorageUnits",
      "purchasing_getPurchasingPlanning",
      "sales_getCustomers",
      "items_getParts",
      "production_getInspectionDocuments",
      "production_getProcedures",
      "quality_getQualityDocuments",
      "resources_getTrainings",
      "resources_getWorkCenters",
      "people_getAttributeCategories"
    ]) {
      const p = props(name);
      expect(p.args, name).toBeUndefined();
      for (const key of ["search", "limit", "offset", "filters", "sorts"]) {
        expect(required(name), name).not.toContain(key);
      }
      expect(p.limit.default, name).toBe(MCP_DEFAULT_LIMIT);
    }
  });

  it("publishes filters (with the operator enum) and sorts where the service applies them", () => {
    const p = props("items_getParts");
    expect(p.filters.items.properties.operator.enum).toContain("startsWith");
    expect(p.filters.items.required).toEqual(["column", "operator"]);
    expect(p.filters.description).toMatch(/comma-separated/);
    expect(p.sorts.items).toMatchObject({
      properties: { sortBy: { type: "string" }, sortAsc: { type: "boolean" } }
    });
    // getPeople forwards args to getEmployees, which applies them.
    expect(props("people_getPeople").filters).toBeDefined();
    // getCurrencies reads only search: no filters or sorts to publish.
    expect(props("accounting_getCurrencies").filters).toBeUndefined();
    expect(props("accounting_getCurrencies").sorts).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The checker reflection itself, on an in-memory project.
// ---------------------------------------------------------------------------

const QUERY_UTILS = path.resolve(__dirname, "../app/utils/query.ts");

function indexFor(service: string): ParamSchemaIndex {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true }
  });
  project.createSourceFile(
    QUERY_UTILS,
    `export interface GenericQueryFilters { limit: number; offset: number; sorts?: { sortBy: string; sortAsc: boolean }[]; filters?: { column: string; operator: string; value?: string }[] }
     export function getGenericFilter(q: any, c: string, operator: string, v: string) {
       switch (operator) { case "eq": return q; case "in": return q; default: throw new Error(); }
     }
     export function setGenericQueryFilters(q: any, args: Partial<GenericQueryFilters>) { return q; }`
  );
  const source = project.createSourceFile(
    "/demo/demo.service.ts",
    `import { type GenericQueryFilters, setGenericQueryFilters, getGenericFilter } from "${QUERY_UTILS.replace(/\.ts$/, "")}";\n${service}`
  );
  return buildParamSchemaIndex(["demo"], {
    project,
    sources: [{ mod: "demo", source }]
  });
}

const param = (index: ParamSchemaIndex, fn: string, name: string) =>
  index.get("demo", fn)?.find((p) => p.name === name) as CheckedParam;

describe("param-schema reflection", () => {
  it("makes initialized, `?` and undefined-admitting params optional", () => {
    const index = indexFor(`
      export function f(client: unknown, a: string, b: number = 1, c?: string, d: string | undefined, e: string[] = []) {}
    `);
    expect(param(index, "f", "client").isContext).toBe(true);
    expect(param(index, "f", "a").optional).toBe(false);
    expect(param(index, "f", "b")).toMatchObject({ optional: true, default: 1 });
    expect(param(index, "f", "b").schema).toEqual({ type: "number" });
    expect(param(index, "f", "c").optional).toBe(true);
    expect(param(index, "f", "d").optional).toBe(true);
    expect(param(index, "f", "d").schema).toEqual({ type: "string" });
    expect(param(index, "f", "e")).toMatchObject({ optional: true, default: [] });
    expect(param(index, "f", "e").schema).toEqual({
      type: "array",
      items: { type: "string" }
    });
  });

  it("an undefined member makes a field optional, never a required null", () => {
    const index = indexFor(`
      /**
       * @param update.assignee Omit to keep it.
       */
      export function f(client: unknown, update: { id: string; assignee: null | undefined; note: string | null }) {}
    `);
    const update = param(index, "f", "update");
    expect(update.fields?.assignee).toMatchObject({
      optional: true,
      schema: { type: "null" }
    });
    expect(update.fields?.note).toMatchObject({
      optional: false,
      schema: { type: ["string", "null"] }
    });
    expect(update.fields?.id.optional).toBe(false);
    expect(update.fieldDescriptions.assignee).toBe("Omit to keep it.");
  });

  it("resolves a named type and marks Json/unknown opaque", () => {
    const index = indexFor(`
      type Options = { method?: "a" | "b"; days?: [number, number] };
      export function f(client: unknown, options: Options = {}, raw: unknown) {}
    `);
    expect(param(index, "f", "options").schema).toEqual({
      type: "object",
      properties: {
        method: { type: "string", enum: ["a", "b"] },
        days: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }
      }
    });
    expect(param(index, "f", "raw").opaque).toBe(true);
  });

  it("traces where a GenericQueryFilters param goes", () => {
    const index = indexFor(`
      export function direct(client: unknown, args: GenericQueryFilters & { search: string | null }) {
        return setGenericQueryFilters({}, args);
      }
      export function forwarded(client: unknown, args: GenericQueryFilters & { search: string | null }) {
        return direct(client, args);
      }
      export function narrowed(client: unknown, args: GenericQueryFilters) {
        const kept = args.filters?.filter(Boolean);
        return setGenericQueryFilters({}, { ...args, filters: kept });
      }
      export function replaced(client: unknown, args: GenericQueryFilters) {
        return setGenericQueryFilters({}, { ...args, sorts: [] });
      }
      export function searchOnly(client: unknown, args: GenericQueryFilters & { search: string | null; active: boolean }) {
        return args.search;
      }
      export function manual(client: unknown, args?: GenericQueryFilters) {
        args?.filters?.forEach((f) => getGenericFilter({}, f.column, f.operator, f.value ?? ""));
      }
    `);
    const usage = (fn: string) => param(index, fn, "args").genericQueryFilters?.usage;
    expect(usage("direct")).toEqual({ paging: true, filters: true, sorts: true });
    expect(usage("forwarded")).toEqual({ paging: true, filters: true, sorts: true });
    expect(usage("narrowed")).toEqual({ paging: true, filters: true, sorts: true });
    expect(usage("replaced")).toEqual({ paging: true, filters: true, sorts: false });
    expect(usage("searchOnly")).toEqual({ paging: false, filters: false, sorts: false });
    expect(usage("manual")).toEqual({ paging: false, filters: true, sorts: false });

    const members = param(index, "searchOnly", "args").genericQueryFilters?.members;
    expect(members?.search).toMatchObject({
      optional: true,
      schema: { type: ["string", "null"] }
    });
    // Required in TypeScript, but services read it with `?? false`.
    expect(members?.active.optional).toBe(true);
    expect(index.filterOperators).toEqual(["eq", "in"]);
  });
});

// ---------------------------------------------------------------------------
// The guard catches each class when it comes back.
// ---------------------------------------------------------------------------

function entry(
  name: string,
  schema: Record<string, unknown>,
  serviceParams: string[]
): ManifestEntry {
  return {
    name: `demo_${name}`,
    module: "demo",
    classification: "READ",
    description: name,
    paramCount: 0,
    serviceParams,
    injectAuth: ["companyId"],
    permission: { module: "demo", actions: ["view"] },
    paginates: false,
    schema
  };
}

describe("findInputSchemaViolations", () => {
  const index = indexFor(`
    export function withDefault(client: unknown, id: string, quantity: number = 1) {}
    export function status(client: unknown, update: { id: string; assignee: null | undefined }) {}
    export function list(client: unknown, locationId: string, args: GenericQueryFilters & { search: string | null }) {
      return setGenericQueryFilters({}, args);
    }
    export function listIgnoringFilters(client: unknown, args: GenericQueryFilters & { search: string | null }) {
      return args.search;
    }
  `);

  it("accepts correct schemas", () => {
    const good = [
      entry(
        "withDefault",
        {
          type: "object",
          properties: { id: { type: "string" }, quantity: { type: "number", default: 1 } },
          required: ["id"]
        },
        ["client", "id", "quantity"]
      ),
      entry(
        "list",
        {
          type: "object",
          properties: {
            search: { type: ["string", "null"] },
            limit: { type: "integer", default: MCP_DEFAULT_LIMIT },
            offset: { type: "integer", default: 0 },
            filters: { type: "array", items: { type: "object" } },
            sorts: { type: "array", items: { type: "object" } },
            locationId: { type: "string" }
          },
          required: ["locationId"]
        },
        ["client", "locationId", "args"]
      )
    ];
    expect(findInputSchemaViolations(good, index)).toEqual([]);
  });

  it("flags each class", () => {
    const bad = [
      entry(
        "withDefault",
        {
          type: "object",
          properties: { id: { type: "string" }, quantity: {} },
          required: ["id", "quantity"]
        },
        ["client", "id", "quantity"]
      ),
      entry(
        "status",
        {
          type: "object",
          properties: { id: { type: "string" }, assignee: { type: "null" } },
          required: ["id", "assignee"]
        },
        ["client", "update"]
      ),
      entry(
        "list",
        {
          type: "object",
          properties: {
            locationId: { type: "string" },
            args: {
              type: "object",
              properties: { limit: { type: "integer", default: 100 } }
            }
          },
          required: ["locationId", "args"]
        },
        ["client", "locationId", "args"]
      ),
      entry(
        "listIgnoringFilters",
        {
          type: "object",
          properties: {
            search: { type: ["string", "null"] },
            limit: { type: "integer", default: MCP_DEFAULT_LIMIT },
            filters: { type: "array", items: { type: "object" } }
          },
          required: ["search"]
        },
        ["client", "args"]
      )
    ];
    expect(findInputSchemaViolations(bad, index)).toEqual([
      'demo_withDefault: param "quantity" is optional in TypeScript but required',
      'demo_withDefault: param "quantity" publishes {} for a typed param',
      'demo_status: "assignee" is required but only accepts null',
      'demo_status: field "assignee" is optional in TypeScript but required',
      "demo_list: GenericQueryFilters param is published nested under args",
      "demo_list: limit default is undefined, not MCP_DEFAULT_LIMIT (25)",
      "demo_list: the service honours filters but the schema omits it",
      "demo_list: the service honours sorts but the schema omits it",
      'demo_listIgnoringFilters: GenericQueryFilters member "search" is required',
      "demo_listIgnoringFilters: the schema publishes filters but the service ignores it"
    ]);
  });
});
