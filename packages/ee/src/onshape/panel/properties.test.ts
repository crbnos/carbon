import { describe, expect, it } from "vitest";
import type { PropertyMapEntry } from "./properties";
import {
  CUSTOM_FIELD_DATA_TYPES,
  coerceOnshapeValue,
  MAPPABLE_VALUE_TYPES,
  mappedFieldValues,
  mergeCustomFieldValues,
  ownedCustomFieldsDiffer,
  parseProperties,
  parsePropertyMap,
  partPropertiesFromElementMetadata,
  propertyDisplayValue,
  propertyMapEqual,
  resolveMappedFields
} from "./properties";

const textField = {
  id: "cf_text",
  name: "Coating",
  dataTypeId: 5,
  listOptions: null
};
const numField = {
  id: "cf_num",
  name: "Mass",
  dataTypeId: 4,
  listOptions: null
};

describe("parseProperties", () => {
  it("normalises the metadata property array and drops malformed rows", () => {
    const properties = parseProperties({
      properties: [
        {
          propertyId: "p1",
          name: "Vendor",
          valueType: "STRING",
          value: "ACME"
        },
        { propertyId: "p2", name: "No type", value: 4 },
        { name: "no id", valueType: "STRING", value: "x" },
        "garbage"
      ]
    });
    expect(properties).toEqual([
      {
        propertyId: "p1",
        name: "Vendor",
        valueType: "STRING",
        value: "ACME",
        editable: undefined
      },
      {
        propertyId: "p2",
        name: "No type",
        valueType: "STRING",
        value: 4,
        editable: undefined
      }
    ]);
  });
});

describe("partPropertiesFromElementMetadata", () => {
  it("returns per-part properties when depth nests parts, else null", () => {
    const nested = partPropertiesFromElementMetadata({
      parts: {
        items: [
          {
            partId: "JHD",
            properties: [
              {
                propertyId: "p1",
                name: "Vendor",
                valueType: "STRING",
                value: "ACME"
              }
            ]
          }
        ]
      }
    });
    expect(nested?.get("JHD")?.[0]?.value).toBe("ACME");
    expect(partPropertiesFromElementMetadata({ properties: [] })).toBeNull();
    expect(
      partPropertiesFromElementMetadata({ parts: { items: [] } })
    ).toBeNull();
  });
});

describe("coerceOnshapeValue / propertyDisplayValue", () => {
  it("coerces each Carbon type and reports what cannot coerce", () => {
    expect(coerceOnshapeValue("ACME", 5, null)).toEqual({
      ok: true,
      value: "ACME"
    });
    expect(coerceOnshapeValue({ displayName: "Steel 4140" }, 5, null)).toEqual({
      ok: true,
      value: "Steel 4140"
    });
    // The ERP reads a ticked Yes/No custom field as the string "on".
    expect(coerceOnshapeValue(true, 1, null)).toEqual({
      ok: true,
      value: "on"
    });
    expect(coerceOnshapeValue("Yes", 1, null)).toEqual({
      ok: true,
      value: "on"
    });
    expect(coerceOnshapeValue(false, 1, null)).toEqual({
      ok: true,
      value: null
    });
    expect(coerceOnshapeValue("No", 1, null)).toEqual({
      ok: true,
      value: null
    });
    expect(coerceOnshapeValue("maybe", 1, null).ok).toBe(false);
    expect(coerceOnshapeValue("2026-08-31T00:00:00Z", 2, null)).toEqual({
      ok: true,
      value: "2026-08-31"
    });
    expect(coerceOnshapeValue("soon", 2, null).ok).toBe(false);
    // Shape alone is not a date.
    expect(coerceOnshapeValue("2026-13-40", 2, null).ok).toBe(false);
    expect(coerceOnshapeValue("2026-02-30", 2, null).ok).toBe(false);
    expect(coerceOnshapeValue(12.5, 4, null)).toEqual({
      ok: true,
      value: 12.5
    });
    expect(coerceOnshapeValue("12.5", 4, null)).toEqual({
      ok: true,
      value: 12.5
    });
    expect(coerceOnshapeValue("heavy", 4, null).ok).toBe(false);
    expect(coerceOnshapeValue("C", 3, ["A", "B"])).toEqual({
      ok: true,
      value: "C"
    });
    expect(coerceOnshapeValue("", 5, null)).toEqual({ ok: true, value: null });
    expect(coerceOnshapeValue(null, 4, null)).toEqual({
      ok: true,
      value: null
    });
    expect(propertyDisplayValue({ name: "Al 6061" })).toBe("Al 6061");
  });
});

describe("parsePropertyMap", () => {
  it("reads entries and treats every one as owned, whatever mode is stored", () => {
    expect(
      parsePropertyMap({
        propertyMap: [
          {
            onshapePropertyId: "p1",
            onshapeName: "Vendor",
            valueType: "STRING",
            carbonFieldId: "cf_text"
          },
          {
            onshapePropertyId: "p2",
            onshapeName: "Line",
            valueType: "ENUM",
            carbonFieldId: "cf_list",
            mode: "default"
          },
          { onshapeName: "broken" }
        ]
      })
    ).toEqual([
      {
        onshapePropertyId: "p1",
        onshapeName: "Vendor",
        valueType: "STRING",
        carbonFieldId: "cf_text",
        mode: "owned"
      },
      {
        onshapePropertyId: "p2",
        onshapeName: "Line",
        valueType: "ENUM",
        carbonFieldId: "cf_list",
        mode: "owned"
      }
    ]);
    expect(parsePropertyMap(null)).toEqual([]);
    expect(parsePropertyMap({ credentials: {} })).toEqual([]);
  });
});

describe("resolveMappedFields", () => {
  const map = [
    {
      onshapePropertyId: "p1",
      onshapeName: "Vendor",
      valueType: "STRING",
      carbonFieldId: "cf_text",
      mode: "owned" as const
    },
    {
      onshapePropertyId: "p2",
      onshapeName: "Mass",
      valueType: "DOUBLE",
      carbonFieldId: "cf_num",
      mode: "default" as const
    },
    {
      onshapePropertyId: "p3",
      onshapeName: "Gone",
      valueType: "STRING",
      carbonFieldId: "cf_deleted",
      mode: "owned" as const
    }
  ];
  const properties = [
    { propertyId: "p1", name: "Vendor", valueType: "STRING", value: "ACME" },
    {
      propertyId: "p2",
      name: "Mass",
      valueType: "DOUBLE",
      value: "not a number"
    },
    { propertyId: "p3", name: "Gone", valueType: "STRING", value: "x" },
    { propertyId: "p4", name: "Project", valueType: "STRING", value: "Apollo" },
    { propertyId: "p5", name: "Name", valueType: "STRING", value: "Lamp base" },
    { propertyId: "p6", name: "Empty", valueType: "STRING", value: "" }
  ];

  it("maps, reports problems, and lists valued unmapped properties", () => {
    const { fields, problems, unmapped } = resolveMappedFields({
      properties,
      map,
      definitions: [textField, numField]
    });
    expect(fields).toEqual([
      {
        fieldId: "cf_text",
        name: "Coating",
        mode: "owned",
        dataTypeId: 5,
        listOptions: null,
        value: "ACME",
        onshapeName: "Vendor"
      }
    ]);
    expect(problems).toEqual([
      'Mass → Mass: "not a number" is not a number',
      "Gone: the mapped Carbon field no longer exists"
    ]);
    // Reserved (Name) and empty properties never show as unmapped.
    expect(unmapped).toEqual([
      {
        propertyId: "p4",
        name: "Project",
        valueType: "STRING",
        value: "Apollo"
      }
    ]);
  });
});

describe("mappedFieldValues", () => {
  it("writes every owned value, null included, and set default values", () => {
    const field = (
      fieldId: string,
      mode: "owned" | "default",
      value: string | null
    ) => ({
      fieldId,
      name: fieldId,
      mode,
      dataTypeId: 5,
      listOptions: null,
      value,
      onshapeName: fieldId
    });
    expect(
      mappedFieldValues([
        field("cf_owned", "owned", "Anodized"),
        field("cf_emptied", "owned", null),
        field("cf_default", "default", "Painted"),
        field("cf_unset", "default", null)
      ])
    ).toEqual({
      cf_owned: "Anodized",
      cf_emptied: null,
      cf_default: "Painted"
    });
  });
});

describe("ownedCustomFieldsDiffer", () => {
  const field = (
    value: string | number | boolean | null,
    mode: "owned" | "default" = "owned"
  ) => ({
    fieldId: "cf-title",
    name: "Title",
    mode,
    dataTypeId: 5,
    listOptions: null,
    value,
    onshapeName: "Description"
  });

  it("is true when a newly mapped value is not in Carbon yet", () => {
    expect(ownedCustomFieldsDiffer({}, [field("Rubber pad")])).toBe(true);
    expect(ownedCustomFieldsDiffer(null, [field("Rubber pad")])).toBe(true);
  });

  it("is false when Carbon already holds the value", () => {
    expect(
      ownedCustomFieldsDiffer({ "cf-title": "Rubber pad" }, [
        field("Rubber pad")
      ])
    ).toBe(false);
  });

  it("is true when Onshape emptied a value Carbon still holds", () => {
    expect(
      ownedCustomFieldsDiffer({ "cf-title": "Rubber pad" }, [field(null)])
    ).toBe(true);
    expect(ownedCustomFieldsDiffer({}, [field(null)])).toBe(false);
  });

  it("ignores fields the push does not own", () => {
    expect(ownedCustomFieldsDiffer({}, [field("x", "default")])).toBe(false);
  });
});

describe("mergeCustomFieldValues", () => {
  it("clears an allowed key whose value is null", () => {
    // An owned property emptied in Onshape empties in Carbon; a key the
    // caller does not list is untouched.
    expect(
      mergeCustomFieldValues(
        { cf_text: "ACME", cf_keep: "ours" },
        { cf_text: null, cf_keep: null },
        new Set(["cf_text"])
      )
    ).toEqual({ cf_keep: "ours" });
  });

  it("touches only allowed keys and keeps Carbon-owned values", () => {
    expect(
      mergeCustomFieldValues(
        { cf_keep: "ours", cf_text: "old" },
        { cf_text: "ACME", cf_blocked: "no" },
        new Set(["cf_text"])
      )
    ).toEqual({ cf_keep: "ours", cf_text: "ACME" });
    expect(
      mergeCustomFieldValues(null, { cf_text: "A" }, new Set(["cf_text"]))
    ).toEqual({ cf_text: "A" });
  });
});

describe("MAPPABLE_VALUE_TYPES", () => {
  /*
   * The supported set is a product decision, not an implementation detail:
   * one Carbon type per Onshape value type, every textual type on Text. A
   * pushed property is reference data Onshape owns, so Carbon holds a
   * faithful copy rather than a constrained one.
   */
  it("offers exactly one target per value type", () => {
    expect(MAPPABLE_VALUE_TYPES).toEqual({
      STRING: [CUSTOM_FIELD_DATA_TYPES.text],
      ENUM: [CUSTOM_FIELD_DATA_TYPES.text],
      BOOL: [CUSTOM_FIELD_DATA_TYPES.boolean],
      INT: [CUSTOM_FIELD_DATA_TYPES.numeric],
      DOUBLE: [CUSTOM_FIELD_DATA_TYPES.numeric],
      DATE: [CUSTOM_FIELD_DATA_TYPES.date],
      OBJECT: [CUSTOM_FIELD_DATA_TYPES.text]
    });
  });

  it("never offers a List target, so no new map can constrain a value", () => {
    for (const targets of Object.values(MAPPABLE_VALUE_TYPES)) {
      expect(targets).not.toContain(CUSTOM_FIELD_DATA_TYPES.list);
    }
  });

  it("leaves the unsupported types out rather than coercing them", () => {
    for (const valueType of ["COMPUTED", "CATEGORY", "USER", "BLOB"]) {
      expect(Object.hasOwn(MAPPABLE_VALUE_TYPES, valueType)).toBe(false);
    }
  });
});

describe("propertyMapEqual", () => {
  const entry = (onshapePropertyId: string, carbonFieldId: string) => ({
    onshapePropertyId,
    carbonFieldId
  });

  it("ignores the order the entries arrive in", () => {
    // Editing one row moves it to the end of the draft, so a positional
    // comparison would call every map dirty after a single click.
    expect(
      propertyMapEqual(
        [entry("p1", "f1"), entry("p2", "f2")],
        [entry("p2", "f2"), entry("p1", "f1")]
      )
    ).toBe(true);
  });

  it("notices a remapped field and a removed row", () => {
    const base = [entry("p1", "f1"), entry("p2", "f2")];
    expect(propertyMapEqual(base, [entry("p1", "f9"), entry("p2", "f2")])).toBe(
      false
    );
    expect(propertyMapEqual(base, [entry("p1", "f1")])).toBe(false);
  });

  it("notices a row mapped to a different property id", () => {
    expect(propertyMapEqual([entry("p1", "f1")], [entry("p2", "f1")])).toBe(
      false
    );
  });

  it("ignores the display fields a load refreshes from Onshape", () => {
    // onshapeName and valueType are re-read on every load; a rename in
    // Onshape is not an unsaved decision by the user.
    const stored: PropertyMapEntry[] = [
      {
        ...entry("p1", "f1"),
        onshapeName: "Vendor",
        valueType: "STRING",
        mode: "owned"
      }
    ];
    const renamed: PropertyMapEntry[] = [
      {
        ...entry("p1", "f1"),
        onshapeName: "Supplier",
        valueType: "ENUM",
        mode: "owned"
      }
    ];
    expect(propertyMapEqual(stored, renamed)).toBe(true);
  });

  it("holds for two empty maps", () => {
    expect(propertyMapEqual([], [])).toBe(true);
  });

  it("does not call a duplicated key equal to two distinct ones", () => {
    expect(
      propertyMapEqual(
        [entry("p1", "f1"), entry("p1", "f1")],
        [entry("p1", "f1"), entry("p2", "f1")]
      )
    ).toBe(false);
  });
});
