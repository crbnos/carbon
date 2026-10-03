// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";
import { defaultsPolicy } from "../../../scripts/lib/service-metadata";

// Regression guards for the MCP tool-metadata generator (scripts/generate-mcp.ts).
// These encode the shape bugs reported against the quote-setup tools AND the
// general classes they belong to, so a future generator change that reintroduces
// any of them fails here instead of silently in a customer's MCP session.

type Tool = {
  name: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  serviceParams: string[];
  upsert?: {
    keys: string[];
    lookups?: { table: string; match: Record<string, string> }[];
  };
  defaults?: "always" | "create";
  schema: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
};

const tools = metadata.tools as Tool[];
const byName = new Map(tools.map((t) => [t.name, t]));
const get = (name: string): Tool => {
  const t = byName.get(name);
  if (!t) throw new Error(`tool ${name} missing from metadata`);
  return t;
};
const props = (t: Tool) => t.schema.properties ?? {};

describe("mcp tool-metadata generator", () => {
  it("totalTools matches the tools array", () => {
    expect(metadata.totalTools).toBe(tools.length);
  });

  // #2 — an array-of-objects service param publishes as an array, not an object.
  it("upsertQuoteLinePrices exposes quoteLinePrices as an array of rows", () => {
    const t = get("sales_upsertQuoteLinePrices");
    const arr = props(t).quoteLinePrices;
    expect(arr?.type).toBe("array");
    expect(arr?.items?.type).toBe("object");
    // createdBy is auth-injected, never a caller field.
    expect(arr?.items?.properties?.createdBy).toBeUndefined();
    expect(Object.keys(arr?.items?.properties ?? {})).toContain("unitPrice");
  });

  // #8 — a delete-and-reinsert write is flagged destructive-by-omission.
  it("upsertQuoteLinePrices is classified DESTRUCTIVE", () => {
    expect(get("sales_upsertQuoteLinePrices").classification).toBe("DESTRUCTIVE");
  });

  // #5 — a validator field after an `errorMap: () => (...)` is not truncated.
  it("upsertQuoteLine still exposes fields that follow an errorMap arrow", () => {
    const p = props(get("sales_upsertQuoteLine"));
    expect(p.quantity?.type).toBe("array");
    for (const field of ["description", "methodType", "unitOfMeasureCode"]) {
      expect(Object.keys(p)).toContain(field);
    }
  });

  // #9 — a `applyX(baseValidator.merge(z.object({...})))` param resolves to real
  // fields instead of an opaque {}. Guard the whole item-validator family.
  it("resolves merge/wrapper validator params to real fields", () => {
    for (const name of [
      "items_upsertService",
      "items_upsertConsumable",
      "items_upsertPart",
      "items_upsertMaterial",
      "items_upsertTool"
    ]) {
      const keys = Object.keys(props(get(name)));
      expect(keys.length).toBeGreaterThan(1);
      expect(keys).toContain("name");
    }
  });

  // General: every array-typed property declares its items shape (no bare arrays
  // that leave a caller guessing the element type).
  it("every array-typed schema property has an items definition", () => {
    for (const t of tools) {
      for (const [key, value] of Object.entries(props(t))) {
        if (value && typeof value === "object" && value.type === "array") {
          expect(value.items, `${t.name}.${key}`).toBeDefined();
        }
      }
    }
  });

  // A `z.infer<typeof V>` NESTED inside an inline object param resolves to the
  // validator's real fields. An untyped {} here invited MCP clients to guess
  // field names — a guessed `contact.phone` reached the insert and failed with
  // PGRST204 ("Could not find the 'phone' column of 'contact'").
  it("resolves nested validator references inside inline object params", () => {
    for (const name of [
      "sales_insertCustomerContact",
      "sales_updateCustomerContact",
      "purchasing_insertSupplierContact",
      "purchasing_updateSupplierContact"
    ]) {
      const contact = props(get(name)).contact;
      expect(contact?.type, name).toBe("object");
      const keys = Object.keys(contact?.properties ?? {});
      expect(keys, name).toContain("firstName");
      expect(keys, name).toContain("workPhone");
      // The table has mobilePhone/homePhone/workPhone — never a bare `phone`.
      expect(keys, name).not.toContain("phone");
    }
    // PickPartial<..., "email"> demotes email from required.
    const insertContact = props(get("sales_insertCustomerContact")).contact;
    expect(insertContact?.required ?? []).not.toContain("email");
  });

  // zod's email conversion emits a ~200-char `pattern` next to
  // `format: "email"` on every email field — the format keyword carries the
  // contract; the regex is stripped to keep describe_tool responses lean.
  it("never publishes pattern alongside format", () => {
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      if (node !== null && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (typeof record.format === "string") {
          expect(record.pattern, path).toBeUndefined();
        }
        for (const [key, value] of Object.entries(record)) {
          walk(value, `${path}.${key}`);
        }
      }
    };
    for (const t of tools) walk(t.schema, t.name);
    // The format itself survives the strip.
    const email = props(get("sales_insertCustomerContact")).contact?.properties
      ?.email;
    expect(email?.format).toBe("email");
  });

  // A `{mod}.mcp.server.ts` export that shares a service function's name
  // SHADOWS it — one tool, the wrapper's implementation, the same published
  // name/schema. Without the generator dedupe the tool appeared twice.
  it("registers a shadowed mcp.server function exactly once", () => {
    const entries = tools.filter(
      (t) => t.name === "production_upsertJobMaterial"
    );
    expect(entries).toHaveLength(1);
    // The wrapper keeps the service's discriminated-upsert contract: its own
    // body branches, and its own doc names the row it updates.
    expect(entries[0]!.upsert).toEqual({
      keys: ["id"],
      lookups: [{ table: "jobMaterial", match: { id: "id" } }]
    });
  });

  // A union/intersection AROUND a validator reference publishes the
  // intersection extras, not the validator verbatim. `jobId` is NOT NULL in
  // the DB but lived only in the `& { jobId: string }` extras, so the schema
  // omitted it and a schema-exact create failed with a 23502 — an MCP agent
  // found this live. Required only where required in EVERY union branch, so a
  // create-only `Omit<…, "id">` branch demotes `id` to optional.
  it("publishes intersection extras on discriminated upserts", () => {
    const jobMaterial = get("production_upsertJobMaterial");
    expect(props(jobMaterial).jobId?.type).toBe("string");
    expect(jobMaterial.schema.required).toContain("jobId");
    expect(Object.keys(props(jobMaterial))).toContain("customFields");

    const quoteMaterial = get("sales_upsertQuoteMaterial");
    expect(quoteMaterial.schema.required).toContain("quoteId");
    expect(quoteMaterial.schema.required).toContain("quoteLineId");

    // Create branch omits `id` (server-minted), update branch has it → optional.
    const quoteOperation = get("sales_upsertQuoteOperation");
    expect(Object.keys(props(quoteOperation))).toContain("id");
    expect(quoteOperation.schema.required ?? []).not.toContain("id");
  });

  // An `Omit<…, "field">` in the service signature is honored — the field the
  // service explicitly refuses must not be re-published from the validator.
  it("honors Omit<> in composed signatures", () => {
    expect(Object.keys(props(get("purchasing_insertSupplier")))).not.toContain(
      "id"
    );
    expect(
      Object.keys(props(get("inventory_insertManualInventoryAdjustment")))
    ).not.toContain("requiresSerialTracking");
  });

  // `zfd.text(z.string().transform((v) => v === "true"))` — the form-post
  // boolean — publishes its two legal values instead of a bare string. An MCP
  // agent passing real booleans got an opaque validation failure.
  it("annotates string-encoded booleans with their legal values", () => {
    const p = props(get("production_upsertJobMaterial"));
    expect(p.requiresBatchTracking?.enum).toEqual(["true", "false"]);
    expect(p.requiresSerialTracking?.enum).toEqual(["true", "false"]);
  });

  // A JSON-string-transform field ALSO maps "true"/"false" to the booleans
  // (`JSON.parse("true") === true`), which used to false-positive the
  // string-encoded-boolean annotator and publish a bogus `enum: ["true","false"]`
  // — so `{}` and `null` failed input validation and `"false"` corrupted the row.
  // Guard the whole class: none of these JSON-payload fields is a boolean enum.
  it("does not mistake JSON-string fields for string-encoded booleans", () => {
    const boolEnum = (field: any) =>
      Array.isArray(field?.enum) &&
      field.enum.length === 2 &&
      field.enum.includes("true") &&
      field.enum.includes("false");

    // methodMaterial.storageUnitIds is a location→bin map, published as a proper
    // object map (or null to clear), and no longer a required field.
    const mm = get("items_upsertMethodMaterial");
    const storageUnitIds = props(mm).storageUnitIds;
    expect(boolEnum(storageUnitIds)).toBe(false);
    const objectBranch = (storageUnitIds?.anyOf ?? [storageUnitIds]).find(
      (b: any) => b?.type === "object"
    );
    expect(objectBranch?.additionalProperties?.type).toBe("string");
    expect(mm.schema.required ?? []).not.toContain("storageUnitIds");

    // The other JSON-string transforms found in the audit.
    expect(boolEnum(props(get("quality_upsertIssueWorkflow")).content)).toBe(
      false
    );
    expect(
      boolEnum(props(get("quality_upsertIssueWorkflow")).requiredActionIds)
    ).toBe(false);
    expect(boolEnum(props(get("quality_upsertGaugeCalibrationRecord")).notes)).toBe(
      false
    );
    expect(boolEnum(props(get("quality_upsertRisk")).notes)).toBe(false);
  });

  // A parenthesized discriminated-upsert union branch resolves instead of
  // publishing an opaque {} member (and the leading-pipe union style must not
  // contribute an empty first member).
  it("resolves parenthesized upsert union branches to real fields", () => {
    const dimension = props(get("accounting_upsertDimension")).dimension;
    const branches = dimension?.anyOf ?? [dimension];
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      expect(Object.keys(branch?.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  // Database["public"]["Enums"][...] fields publish real enum values from the
  // generated types, so a client picks from the actual statuses.
  it("resolves generated DB enum references to value enums", () => {
    const status = props(get("inventory_updatePickingListStatus")).status;
    expect(status?.enum).toContain("In Progress");
    const mode = props(get("items_updateChangeNoticeAffectedItemCutover"))
      .supersessionMode;
    expect(mode?.enum).toContain("Consume First");
  });

  // Database["public"]["Tables"][t]["Insert"] params publish the table's own
  // columns (auth-injected fields stripped) — no more guessing what a tag is.
  it("resolves generated DB table types to real columns", () => {
    const tag = props(get("shared_insertTag")).tag;
    expect(tag?.type).toBe("object");
    expect(tag?.required).toEqual(["name", "table"]);
    expect(tag?.properties?.companyId).toBeUndefined();
    expect(tag?.properties?.createdBy).toBeUndefined();
  });

  // Array<{...}> generics publish as typed arrays, same as the `[]` suffix.
  it("resolves Array<T> generic params to typed arrays", () => {
    const sourceTools = props(get("production_maxToolQuantityByItem")).sourceTools;
    expect(sourceTools?.type).toBe("array");
    expect(Object.keys(sourceTools?.items?.properties ?? {})).toContain("itemId");
  });

  // A bare type alias declared in the module's own sources (service file,
  // types.ts, models, or shared) resolves; Partial<{...}> drops required.
  // `diffMethod(input: DiffMethodInput)` — DiffMethodInput is a named type
  // alias declared in items.service.ts, so it must resolve to real properties
  // rather than an opaque {}.
  it("resolves module-local type aliases and Partial wrappers", () => {
    const input = props(get("items_diffMethod")).input;
    const inputBranches = input?.anyOf ?? [input];
    expect(
      Object.keys(inputBranches[0]?.properties ?? {}).length
    ).toBeGreaterThan(0);

    // updateAbility takes an optional `name` and an optional cadence, so the
    // published schema has both fields and no required list.
    const ability = props(get("resources_updateAbility")).ability;
    expect(Object.keys(ability?.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "recertifyEveryDays"])
    );
    expect(ability?.required).toBeUndefined();
  });

  // Insert-vs-update discriminator, BOTH directions, gets an upsert rule.
  // upsertQuoteMaterial / upsertJobMaterial branch on `if ("updatedBy" in …)` — the
  // generator used to detect only the `"createdBy" in` convention, so the dispatch
  // always stamped updatedBy and every create was forced down the UPDATE branch
  // (0 rows → PGRST116, silent no-op). The rule is what lets the dispatcher stamp
  // exactly one audit field without the caller saying which.
  // `assignee: null | undefined` published as a REQUIRED null on the status
  // tools, so every status change had to send `assignee: null` and cleared it.
  it("does not require a field whose type admits undefined", () => {
    expect(get("sales_updateQuoteStatus").schema.required).toEqual([
      "id",
      "status"
    ]);
    expect(get("quality_updateIssueStatus").schema.required).toEqual([
      "id",
      "status"
    ]);
  });

  // The rpc advances `sequence.next`, so calling it consumes a document number.
  // It was published as a READ gated on `settings:view`.
  it("publishes getNextSequence as a write gated on settings:update", () => {
    const t = get("settings_getNextSequence") as Tool & {
      permission: { module: string; actions: string[] };
    };
    expect(t.classification).toBe("WRITE");
    expect(t.permission).toEqual({ module: "settings", actions: ["update"] });
  });

  it("never requires a property that can only be null", () => {
    const offenders: string[] = [];
    const walk = (name: string, schema: any, path: string) => {
      if (!schema || typeof schema !== "object") return;
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (properties[required]?.type === "null") {
          offenders.push(`${name}: ${path}${required}`);
        }
      }
      for (const [key, value] of Object.entries(properties)) {
        walk(name, value, `${path}${key}.`);
      }
      walk(name, schema.items, `${path}[].`);
    };
    for (const t of tools) walk(t.name, t.schema, "");
    expect(offenders).toEqual([]);
  });

  it("gives an upsert rule to `\"updatedBy\" in` upserts, not only `\"createdBy\" in` ones", () => {
    // Inverted (`"updatedBy" in`), id decides.
    expect(get("production_upsertJob").upsert).toEqual({ keys: ["id"] });
    expect(get("production_upsertProductionQuantity").upsert).toEqual({
      keys: ["id"]
    });
    // Inverted, id required either way — looked up.
    expect(get("sales_upsertQuoteMaterial").upsert?.lookups).toEqual([
      { table: "quoteMaterial", match: { id: "id" } }
    ]);
    expect(get("resources_upsertPartner").upsert?.lookups).toEqual([
      { table: "partner", match: { id: "id" } }
    ]);
    // Standard (`"createdBy" in`) control.
    expect(get("sales_upsertCustomerType").upsert).toEqual({ keys: ["id"] });
  });

  // `_operation: "create" | "update"` made every caller state what the server
  // can work out. It is gone from every schema; a non-branching write has no rule.
  it("never asks the caller whether an upsert creates or updates", () => {
    for (const tool of tools) {
      expect(JSON.stringify(tool.schema), tool.name).not.toContain("_operation");
    }
    expect(get("sales_insertQuote").upsert).toBeUndefined();
    expect(props(get("sales_upsertCustomerType")).id?.description).toContain(
      "omit to create"
    );
  });
});

// A default in a schema is a promise: leave the field out and you get it. The
// generator publishes one only where the dispatcher keeps the promise.
describe("published defaults", () => {
  const publishes = (tool: Tool) => JSON.stringify(tool.schema).includes('"default":');

  it("are filled always for a whole value, on create for an upsert, never on update", () => {
    const rule = { keys: ["id"] };
    expect(defaultsPolicy("read", undefined)).toBe("always");
    expect(defaultsPolicy("create", undefined)).toBe("always");
    expect(defaultsPolicy("action", undefined)).toBe("always");
    expect(defaultsPolicy("upsert", rule)).toBe("create");
    // No rule: the dispatcher cannot tell whether the call updates.
    expect(defaultsPolicy("upsert", undefined)).toBeUndefined();
    expect(defaultsPolicy("update", undefined)).toBeUndefined();
    expect(defaultsPolicy("delete", undefined)).toBeUndefined();
  });

  it("no tool publishes a default without saying when it is filled", () => {
    const silent = tools.filter((tool) => publishes(tool) && !tool.defaults);
    expect(silent.map((tool) => tool.name)).toEqual([]);
    const empty = tools.filter((tool) => tool.defaults && !publishes(tool));
    expect(empty.map((tool) => tool.name)).toEqual([]);
  });

  it("a create-only default needs a rule that says what a create is", () => {
    const unruled = tools.filter(
      (tool) => tool.defaults === "create" && !tool.upsert
    );
    expect(unruled.map((tool) => tool.name)).toEqual([]);
  });

  it("an update never publishes one", () => {
    for (const name of [
      "purchasing_updateSupplierTax",
      "sales_updateCustomerTax",
      "sales_updatePricingRule",
      "invoicing_updateReimbursement"
    ]) {
      expect(publishes(get(name)), name).toBe(false);
    }
    // An upsert keeps it, for its create.
    expect(get("purchasing_upsertPurchaseOrderLine").defaults).toBe("create");
    expect(props(get("purchasing_upsertPurchaseOrderLine")).taxPercent).toMatchObject({
      default: 0
    });
  });

  it("an upsert that branches on its id has a rule, like one that branches on an audit field", () => {
    // `"id" in line`: without a rule both audit fields were stamped on every call.
    expect(get("purchasing_upsertPurchaseOrderLine").upsert).toEqual({ keys: ["id"] });
    expect(get("invoicing_upsertSalesInvoiceLine").upsert).toEqual({ keys: ["id"] });
    // Its row is made with the invoice and shares its id: `id` was required in
    // both shapes, so the insert branch never ran. It is an update, and says so.
    const delivery = get("invoicing_upsertPurchaseInvoiceDelivery");
    expect(delivery.upsert).toBeUndefined();
    expect(delivery.schema.required).toContain("id");
    expect(publishes(delivery)).toBe(false);
  });
});
