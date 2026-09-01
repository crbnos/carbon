import { describe, expect, it } from "vitest";
import {
  coerceOnshapeValue,
  mergeCustomFieldEdits,
  mergeCustomFieldValues,
  missingListOptions,
  parseProperties,
  parsePropertyMap,
  partPropertiesFromElementMetadata,
  propertyDisplayValue,
  resolveMappedFields
} from "./properties";

const textField = {
  id: "cf_text",
  name: "Coating",
  dataTypeId: 5,
  listOptions: null
};
const listField = {
  id: "cf_list",
  name: "Line",
  dataTypeId: 3,
  listOptions: ["A", "B"]
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
  it("reads entries and defaults mode to owned", () => {
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
        mode: "default"
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

describe("mergeCustomFieldEdits", () => {
  const fields = [
    {
      fieldId: "cf_text",
      name: "Coating",
      mode: "owned" as const,
      dataTypeId: 5,
      listOptions: null,
      value: "Anodized",
      onshapeName: "Coating"
    },
    {
      fieldId: "cf_num",
      name: "Mass",
      mode: "default" as const,
      dataTypeId: 4,
      listOptions: null,
      value: 2.5,
      onshapeName: "Mass"
    }
  ];

  it("applies default-mode edits, refuses owned and bad values", () => {
    expect(mergeCustomFieldEdits(fields, { cf_num: "3.5" })).toEqual({
      ok: true,
      values: { cf_text: "Anodized", cf_num: 3.5 }
    });
    expect(mergeCustomFieldEdits(fields, { cf_text: "Painted" })).toEqual({
      ok: false,
      errors: ["Coating: Onshape owns this field"]
    });
    expect(mergeCustomFieldEdits(fields, { cf_num: "heavy" })).toEqual({
      ok: false,
      errors: ['Mass: "heavy" is not a number']
    });
    // Clearing a default value drops the key; unknown keys are ignored.
    expect(
      mergeCustomFieldEdits(fields, { cf_num: "", cf_other: "x" })
    ).toEqual({
      ok: true,
      values: { cf_text: "Anodized" }
    });
  });
});

describe("mergeCustomFieldValues / missingListOptions", () => {
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

  it("lists unseen options for list fields only", () => {
    expect(missingListOptions(listField, ["A", "C", "C", null])).toEqual(["C"]);
    expect(missingListOptions(textField, ["A"])).toEqual([]);
  });
});
