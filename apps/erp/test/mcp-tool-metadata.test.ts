import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Regression guards for the MCP tool-metadata generator (scripts/generate-mcp.ts).
// These encode the shape bugs reported against the quote-setup tools AND the
// general classes they belong to, so a future generator change that reintroduces
// any of them fails here instead of silently in a customer's MCP session.

type Tool = {
  name: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  serviceParams: string[];
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
    const forecasts = props(get("production_upsertDemandForecasts")).forecasts;
    expect(forecasts?.type).toBe("array");
    expect(Object.keys(forecasts?.items?.properties ?? {})).toContain("itemId");
  });

  // A bare type alias declared in the module's own sources (service file,
  // types.ts, models, or shared) resolves; Partial<{...}> drops required.
  it("resolves module-local type aliases and Partial wrappers", () => {
    const rule = props(get("shared_upsertApprovalRule")).rule;
    const ruleBranches = rule?.anyOf ?? [rule];
    expect(
      Object.keys(ruleBranches[0]?.properties ?? {}).length
    ).toBeGreaterThan(0);

    const ability = props(get("resources_updateAbility")).ability;
    expect(Object.keys(ability?.properties ?? {})).toContain("name");
    expect(ability?.required).toBeUndefined();
  });

  // Insert-vs-update discriminator, BOTH directions, gets a required `_operation`.
  // upsertQuoteMaterial / upsertJobMaterial branch on `if ("updatedBy" in …)` — the
  // generator used to detect only the `"createdBy" in` convention, so these tools
  // shipped without `_operation`, the dispatch always stamped updatedBy, and every
  // create was forced down the UPDATE branch (0 rows → PGRST116, silent no-op).
  it("gives an `_operation` flag to `\"updatedBy\" in` upserts, not only `\"createdBy\" in` ones", () => {
    const requiresOperation = (name: string) => {
      const t = get(name);
      expect(props(t)._operation, `${name} should expose _operation`).toMatchObject({
        enum: ["create", "update"]
      });
      expect(t.schema.required ?? [], `${name} should require _operation`).toContain(
        "_operation"
      );
    };
    // Inverted (`"updatedBy" in`) — the ones that were broken.
    requiresOperation("sales_upsertQuoteMaterial");
    requiresOperation("production_upsertJobMaterial");
    requiresOperation("production_upsertJob");
    requiresOperation("production_upsertProductionQuantity");
    requiresOperation("resources_upsertPartner");
    // Standard (`"createdBy" in`) control — unchanged, still carries the flag.
    requiresOperation("sales_upsertQuoteOperation");
  });
});
