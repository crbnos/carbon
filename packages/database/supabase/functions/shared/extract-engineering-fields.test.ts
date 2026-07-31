import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { extractEngineeringFields } from "./extract-engineering-fields.ts";

// A flattened BOM row as the BOM route produces it: one property per Onshape
// BOM header, Material already collapsed to its display name.
const bomRow = {
  Item: "1.1",
  "Part number": "P000123",
  Revision: "A",
  Name: "Bracket",
  Quantity: 2,
  State: "Released",
  Mass: "1.42 kg",
  Material: "Aluminum 6061",
  Vendor: "Acme Machining"
};

Deno.test("reads the standard header names", () => {
  assertEquals(extractEngineeringFields(bomRow), {
    state: "Released",
    mass: "1.42 kg",
    material: "Aluminum 6061",
    vendor: "Acme Machining"
  });
});

Deno.test("matches headers regardless of case or padding", () => {
  assertEquals(
    extractEngineeringFields({
      state: "In progress",
      MASS: "0.5 kg",
      "  Material  ": "Steel 1018",
      vEnDoR: "Contoso"
    }),
    {
      state: "In progress",
      mass: "0.5 kg",
      material: "Steel 1018",
      vendor: "Contoso"
    }
  );
});

Deno.test("accepts Supplier as an alias for Vendor", () => {
  assertEquals(extractEngineeringFields({ Supplier: "Acme" }).vendor, "Acme");
});

Deno.test("prefers Vendor over Supplier when both are present", () => {
  assertEquals(
    extractEngineeringFields({ Vendor: "Acme", Supplier: "Contoso" }).vendor,
    "Acme"
  );
});

Deno.test("falls through to the next alias when the first is blank", () => {
  assertEquals(
    extractEngineeringFields({ Vendor: "   ", Supplier: "Contoso" }).vendor,
    "Contoso"
  );
});

Deno.test("returns null for every field a row does not carry", () => {
  assertEquals(
    extractEngineeringFields({ Item: "1", "Part number": "P000123" }),
    { state: null, mass: null, material: null, vendor: null }
  );
});

Deno.test("treats an empty or whitespace-only cell as missing", () => {
  assertEquals(extractEngineeringFields({ State: "", Mass: "  " }), {
    state: null,
    mass: null,
    material: null,
    vendor: null
  });
});

Deno.test("coerces non-string primitives to text", () => {
  assertEquals(extractEngineeringFields({ Mass: 1.42 }).mass, "1.42");
  assertEquals(extractEngineeringFields({ Mass: 0 }).mass, "0");
  assertEquals(extractEngineeringFields({ State: true }).state, "true");
  assertEquals(extractEngineeringFields({ Mass: 10n }).mass, "10");
  assertEquals(extractEngineeringFields({ Mass: Number.NaN }).mass, null);
});

Deno.test("drops an unresolved object cell rather than stringifying it", () => {
  assertEquals(
    extractEngineeringFields({
      Material: { displayName: "Aluminum 6061" },
      Vendor: ["Acme"]
    }),
    { state: null, mass: null, material: null, vendor: null }
  );
});

Deno.test("never throws on a row that is not an object", () => {
  const allNull = { state: null, mass: null, material: null, vendor: null };
  assertEquals(
    extractEngineeringFields(null as unknown as Record<string, unknown>),
    allNull
  );
  assertEquals(
    extractEngineeringFields(undefined as unknown as Record<string, unknown>),
    allNull
  );
  assertEquals(
    extractEngineeringFields("Released" as unknown as Record<string, unknown>),
    allNull
  );
  assertEquals(
    extractEngineeringFields([] as unknown as Record<string, unknown>),
    allNull
  );
  assertEquals(extractEngineeringFields({}), allNull);
});

Deno.test("never throws when reading a cell blows up", () => {
  const hostileRow = {} as Record<string, unknown>;
  Object.defineProperty(hostileRow, "State", {
    enumerable: true,
    get() {
      throw new Error("unreadable cell");
    }
  });

  assertEquals(extractEngineeringFields(hostileRow), {
    state: null,
    mass: null,
    material: null,
    vendor: null
  });
});
