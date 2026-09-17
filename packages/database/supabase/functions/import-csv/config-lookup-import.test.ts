import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { CONFIGS } from "./config-lookup-import.ts";

Deno.test("unit of measure requires both a code and a name", () => {
  assertEquals(
    CONFIGS.unitOfMeasure.validate({ code: "", name: "Each" }),
    "Code is required"
  );
  assertEquals(
    CONFIGS.unitOfMeasure.validate({ code: "EA", name: "  " }),
    "Name is required"
  );
  assertEquals(CONFIGS.unitOfMeasure.validate({ code: "EA", name: "Each" }), null);
});

Deno.test("unit of measure enforces the same lengths the form does", () => {
  assertEquals(
    CONFIGS.unitOfMeasure.validate({ code: "X".repeat(11), name: "Each" }),
    "Code must be 10 characters or fewer"
  );
  assertEquals(
    CONFIGS.unitOfMeasure.validate({ code: "EA", name: "X".repeat(51) }),
    "Name must be 50 characters or fewer"
  );
});

// unitOfMeasure has UNIQUE (code, companyId) AND UNIQUE (name, companyId).
// Dedup on the code alone would let a row with a fresh code but a taken name
// through, where ON CONFLICT DO NOTHING would drop it with no reported reason.
Deno.test("unit of measure dedups on code and name", () => {
  const existing = CONFIGS.unitOfMeasure.keysOfExisting({
    name: "Each",
    code: "EA"
  });
  const sameNameNewCode = CONFIGS.unitOfMeasure.keysOf({
    code: "EACH",
    name: "each"
  });
  assertEquals(
    sameNameNewCode.some((k) => existing.includes(k)),
    true
  );
});

Deno.test("name-keyed lookups match case- and whitespace-insensitively", () => {
  for (const table of ["storageType", "scrapReason", "department"] as const) {
    assertEquals(
      CONFIGS[table].keysOf({ name: "  Cold Storage " }),
      CONFIGS[table].keysOfExisting({ name: "cold storage" })
    );
  }
});

Deno.test("optional columns are omitted rather than written blank", () => {
  assertEquals(CONFIGS.itemPostingGroup.values({ name: "Finished Goods" }), {
    name: "Finished Goods"
  });
  assertEquals(
    CONFIGS.itemPostingGroup.values({
      name: "Finished Goods",
      description: "  "
    }),
    { name: "Finished Goods" }
  );
  assertEquals(
    CONFIGS.itemPostingGroup.values({
      name: " Finished Goods ",
      description: " Sellable "
    }),
    { name: "Finished Goods", description: "Sellable" }
  );
});

// Only `department` carries a parent; the second pass in `importConfigLookups`
// is gated on this field, so a stray one would start resolving parent names
// against a table that has no parent column.
Deno.test("department is the only table with a parent pass", () => {
  const withParent = (
    Object.keys(CONFIGS) as Array<keyof typeof CONFIGS>
  ).filter((table) => CONFIGS[table].parentField);
  assertEquals(withParent, ["department"]);
});
