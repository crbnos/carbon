// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { PropertyMapEntry } from "./properties";
import {
  CUSTOM_FIELD_DATA_TYPES,
  coerceOnshapeValue,
  customFieldKeptDifferences,
  customFieldWrites,
  MAPPABLE_VALUE_TYPES,
  mappedFieldValues,
  mergeCustomFieldValues,
  parseDescriptionModes,
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

  it("reads a list value as its option's label, the text the BOM shows", () => {
    const [state, unit, unknown] = parseProperties({
      properties: [
        {
          propertyId: "p1",
          name: "State",
          valueType: "ENUM",
          value: "2",
          enumValues: [
            { label: "In progress", value: "0" },
            { label: "Released", value: "2" }
          ]
        },
        {
          propertyId: "p2",
          name: "Unit of measure",
          valueType: "ENUM",
          value: "Each",
          enumValues: [{ label: null, value: "Each" }]
        },
        {
          propertyId: "p3",
          name: "Finish",
          valueType: "ENUM",
          value: "9",
          enumValues: [{ label: "Painted", value: "1" }]
        }
      ]
    });
    expect(state?.value).toBe("Released");
    expect(unit?.value).toBe("Each");
    expect(unknown?.value).toBe("9");
  });

  it("lists a list's options as labels, the value where a label is empty", () => {
    const [state, unit, text] = parseProperties({
      properties: [
        {
          propertyId: "p1",
          name: "State",
          valueType: "ENUM",
          value: "0",
          enumValues: [
            { label: "In progress", value: "0" },
            { label: "Released", value: "2" }
          ]
        },
        {
          propertyId: "p2",
          name: "Unit of measure",
          valueType: "ENUM",
          value: "Each",
          enumValues: [{ label: "", value: "Each" }, "garbage"]
        },
        { propertyId: "p3", name: "MPN", valueType: "STRING", value: "X" }
      ]
    });
    expect(state?.options).toEqual(["In progress", "Released"]);
    expect(unit?.options).toEqual(["Each"]);
    expect(text?.options).toBeUndefined();
  });

  it("reads N/A as no value, as a BOM row does", () => {
    const [mpn] = parseProperties({
      properties: [
        { propertyId: "p1", name: "MPN", valueType: "STRING", value: "N/A" }
      ]
    });
    expect(mpn?.value).toBeNull();
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
  it("reads the earlier shape: carbonFieldId is a custom field, owned is every push", () => {
    expect(
      parsePropertyMap({
        propertyMap: [
          {
            onshapePropertyId: "p1",
            onshapeName: "Vendor",
            valueType: "STRING",
            carbonFieldId: "cf_text",
            mode: "owned"
          },
          {
            onshapePropertyId: "p2",
            onshapeName: "Finish",
            valueType: "ENUM",
            carbonFieldId: "cf_list",
            mode: "default"
          },
          {
            onshapePropertyId: "p3",
            onshapeName: "Coating",
            valueType: "STRING",
            carbonFieldId: "cf_other"
          }
        ]
      })
    ).toEqual([
      {
        onshapePropertyId: "p1",
        onshapeName: "Vendor",
        valueType: "STRING",
        target: { kind: "customField", fieldId: "cf_text" },
        mode: "everyPush"
      },
      {
        onshapePropertyId: "p2",
        onshapeName: "Finish",
        valueType: "ENUM",
        target: { kind: "customField", fieldId: "cf_list" },
        mode: "create"
      },
      {
        onshapePropertyId: "p3",
        onshapeName: "Coating",
        valueType: "STRING",
        target: { kind: "customField", fieldId: "cf_other" },
        mode: "create"
      }
    ]);
    expect(parsePropertyMap(null)).toEqual([]);
    expect(parsePropertyMap({ credentials: {} })).toEqual([]);
  });

  it("reads item targets with their translation", () => {
    expect(
      parsePropertyMap({
        propertyMap: [
          {
            onshapePropertyId: "p1",
            onshapeName: "Make or buy",
            valueType: "ENUM",
            target: { kind: "item", field: "replenishmentSystem" },
            mode: "everyPush",
            translations: [
              { onshape: "Purchased", carbon: "Buy" },
              { onshape: "Unknown", carbon: null }
            ]
          }
        ]
      })
    ).toEqual([
      {
        onshapePropertyId: "p1",
        onshapeName: "Make or buy",
        valueType: "ENUM",
        target: { kind: "item", field: "replenishmentSystem" },
        mode: "everyPush",
        translations: [
          { onshape: "Purchased", carbon: "Buy" },
          { onshape: "Unknown", carbon: null }
        ]
      }
    ]);
  });

  it("gives a list item field with no stored translation the default rows", () => {
    const [entry] = parsePropertyMap({
      propertyMap: [
        {
          onshapePropertyId: "p1",
          onshapeName: "Tracking",
          valueType: "STRING",
          target: { kind: "item", field: "itemTrackingType" },
          mode: "create"
        }
      ]
    });
    expect(entry?.translations?.map((row) => row.onshape)).toEqual([
      "Inventory",
      "Non-Inventory",
      "Serial",
      "Batch"
    ]);
  });

  it("drops an entry with an unknown target", () => {
    expect(
      parsePropertyMap({
        propertyMap: [
          {
            onshapePropertyId: "p1",
            onshapeName: "Price",
            valueType: "DOUBLE",
            target: { kind: "item", field: "unitCost" },
            mode: "create"
          }
        ]
      })
    ).toEqual([]);
  });
});

describe("parseDescriptionModes", () => {
  it("defaults each description to Set at creation", () => {
    expect(parseDescriptionModes(null)).toEqual({
      name: "create",
      description: "create"
    });
    expect(
      parseDescriptionModes({
        descriptionModes: { name: "everyPush", description: "owned" }
      })
    ).toEqual({ name: "everyPush", description: "create" });
  });
});

describe("resolveMappedFields", () => {
  const map = [
    {
      onshapePropertyId: "p1",
      onshapeName: "Vendor",
      valueType: "STRING",
      target: { kind: "customField" as const, fieldId: "cf_text" },
      mode: "everyPush" as const
    },
    {
      onshapePropertyId: "p2",
      onshapeName: "Mass",
      valueType: "DOUBLE",
      target: { kind: "customField" as const, fieldId: "cf_num" },
      mode: "create" as const
    },
    {
      onshapePropertyId: "p3",
      onshapeName: "Gone",
      valueType: "STRING",
      target: { kind: "customField" as const, fieldId: "cf_deleted" },
      mode: "everyPush" as const
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
        mode: "everyPush",
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

  it("does not throw on a BOM column Onshape sent without a name", () => {
    const { unmapped } = resolveMappedFields({
      properties: [
        {
          propertyId: "p-unnamed",
          name: undefined as unknown as string,
          valueType: "STRING",
          value: "X"
        }
      ],
      map: [],
      definitions: []
    });
    expect(unmapped.map((property) => property.propertyId)).toEqual([
      "p-unnamed"
    ]);
  });

  it("treats a relabelled identity column as reserved, whatever its case", () => {
    const { unmapped } = resolveMappedFields({
      properties: [
        {
          propertyId: "p-pn",
          name: "PART NUMBER",
          valueType: "STRING",
          value: "A-1"
        },
        {
          propertyId: "p-state",
          name: "STATE",
          valueType: "STRING",
          value: "Released"
        }
      ],
      map: [],
      definitions: []
    });
    expect(unmapped).toEqual([]);
  });
});

describe("resolveMappedFields — item fields", () => {
  const units = [
    { code: "EA", name: "Each" },
    { code: "KG", name: "Kilogram" }
  ];
  const map: PropertyMapEntry[] = [
    {
      onshapePropertyId: "p-make",
      onshapeName: "Make or buy",
      valueType: "ENUM",
      target: { kind: "item", field: "replenishmentSystem" },
      mode: "create",
      translations: [
        { onshape: "Buy", carbon: "Buy" },
        { onshape: "Make", carbon: "Make" },
        { onshape: "Either", carbon: null }
      ]
    },
    {
      onshapePropertyId: "p-mpn",
      onshapeName: "Vendor part",
      valueType: "STRING",
      target: { kind: "item", field: "mpn" },
      mode: "everyPush"
    },
    {
      onshapePropertyId: "p-unit",
      onshapeName: "Unit",
      valueType: "STRING",
      target: { kind: "item", field: "unitOfMeasureCode" },
      mode: "create",
      translations: []
    }
  ];
  const property = (propertyId: string, name: string, value: unknown) => ({
    propertyId,
    name,
    valueType: "STRING",
    value
  });

  it("translates list values and keeps text as it is, with its source", () => {
    const { itemFields, problems } = resolveMappedFields({
      properties: [
        property("p-make", "Make or buy", " buy "),
        property("p-mpn", "Vendor part", "SKF-6203"),
        property("p-unit", "Unit", "kilogram")
      ],
      map,
      definitions: [],
      units
    });
    expect(problems).toEqual([]);
    expect(itemFields).toEqual([
      {
        field: "replenishmentSystem",
        label: "Replenishment",
        value: "Buy",
        mode: "create",
        onshapeName: "Make or buy"
      },
      {
        field: "mpn",
        label: "Manufacturer Part Number",
        value: "SKF-6203",
        mode: "everyPush",
        onshapeName: "Vendor part"
      },
      {
        field: "unitOfMeasureCode",
        label: "Unit of Measure",
        value: "KG",
        mode: "create",
        onshapeName: "Unit"
      }
    ]);
  });

  it("reports a value no row matches, and gives No value for a row set to it", () => {
    const outsourced = resolveMappedFields({
      properties: [property("p-make", "Make or buy", "Outsourced")],
      map,
      definitions: [],
      units
    });
    expect(outsourced.itemFields).toEqual([]);
    expect(outsourced.problems).toEqual([
      'Make or buy: "Outsourced" has no Carbon value. Replenishment not written.'
    ]);
    const either = resolveMappedFields({
      properties: [property("p-make", "Make or buy", "Either")],
      map,
      definitions: [],
      units
    });
    expect(either.problems).toEqual([]);
    expect(either.itemFields[0]?.value).toBeNull();
  });

  it("matches a BOM column by name when its id is not the property id", () => {
    const { itemFields } = resolveMappedFields({
      properties: [property("column-7", "Make or buy", "Make")],
      map,
      definitions: [],
      units,
      matchByName: true
    });
    expect(itemFields.map((field) => field.value)).toEqual(["Make"]);
    expect(
      resolveMappedFields({
        properties: [property("column-7", "Make or buy", "Make")],
        map,
        definitions: [],
        units
      }).itemFields
    ).toEqual([]);
  });
});

describe("mappedFieldValues", () => {
  const field = (
    fieldId: string,
    mode: "create" | "everyPush",
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
  const fields = [
    field("cf_every", "everyPush", "Anodized"),
    field("cf_emptied", "everyPush", null),
    field("cf_create", "create", "Painted"),
    field("cf_unset", "create", null)
  ];

  it("writes every value on a create, nulls left out", () => {
    const { values, fieldIds } = mappedFieldValues(fields, true);
    expect(values).toEqual({ cf_every: "Anodized", cf_create: "Painted" });
    expect([...fieldIds]).toEqual(["cf_every", "cf_create"]);
  });

  it("writes only every-push values on an existing item, nulls included", () => {
    const { values, fieldIds } = mappedFieldValues(fields, false);
    expect(values).toEqual({ cf_every: "Anodized", cf_emptied: null });
    expect([...fieldIds]).toEqual(["cf_every", "cf_emptied"]);
  });
});

describe("customFieldWrites", () => {
  const field = (
    value: string | number | boolean | null,
    mode: "create" | "everyPush" = "everyPush"
  ) => ({
    fieldId: "cf-title",
    name: "Title",
    mode,
    dataTypeId: 5,
    listOptions: null,
    value,
    onshapeName: "Description"
  });

  it("writes a newly mapped value that Carbon does not hold yet", () => {
    expect(customFieldWrites({}, [field("Rubber pad")])).toHaveLength(1);
    expect(customFieldWrites(null, [field("Rubber pad")])).toHaveLength(1);
  });

  it("writes nothing when Carbon already holds the value", () => {
    expect(
      customFieldWrites({ "cf-title": "Rubber pad" }, [field("Rubber pad")])
    ).toEqual([]);
  });

  it("clears a value Onshape emptied, and only when Carbon holds one", () => {
    expect(
      customFieldWrites({ "cf-title": "Rubber pad" }, [field(null)])
    ).toHaveLength(1);
    expect(customFieldWrites({}, [field(null)])).toEqual([]);
    expect(customFieldWrites({ "cf-title": "" }, [field(null)])).toEqual([]);
  });

  it("never writes a Set at creation field to an existing item", () => {
    expect(customFieldWrites({}, [field("x", "create")])).toEqual([]);
  });
});

describe("customFieldKeptDifferences", () => {
  const field = (value: string | null, mode: "create" | "everyPush") => ({
    fieldId: "cf-title",
    name: "Title",
    mode,
    dataTypeId: 5,
    listOptions: null,
    value,
    onshapeName: "Description"
  });

  it("lists a Set at creation value that differs from Carbon's", () => {
    expect(
      customFieldKeptDifferences({ "cf-title": "Ours" }, [
        field("Theirs", "create")
      ])
    ).toHaveLength(1);
    expect(
      customFieldKeptDifferences({ "cf-title": "Same" }, [
        field("Same", "create")
      ])
    ).toEqual([]);
    expect(
      customFieldKeptDifferences({}, [field("Theirs", "everyPush")])
    ).toEqual([]);
    expect(customFieldKeptDifferences({}, [field(null, "create")])).toEqual([]);
  });
});

describe("mergeCustomFieldValues", () => {
  it("clears an allowed key whose value is null", () => {
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
  const entry = (
    onshapePropertyId: string,
    fieldId: string,
    mode: "create" | "everyPush" = "create"
  ) => ({
    onshapePropertyId,
    target: { kind: "customField" as const, fieldId },
    mode
  });

  it("ignores the order the entries arrive in", () => {
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

  it("notices a changed mode and a changed translation", () => {
    expect(
      propertyMapEqual([entry("p1", "f1")], [entry("p1", "f1", "everyPush")])
    ).toBe(false);
    const item = (carbon: string | null) => ({
      onshapePropertyId: "p1",
      target: { kind: "item" as const, field: "replenishmentSystem" as const },
      mode: "create" as const,
      translations: [{ onshape: "Buy", carbon }]
    });
    expect(propertyMapEqual([item("Buy")], [item("Buy")])).toBe(true);
    expect(propertyMapEqual([item("Buy")], [item(null)])).toBe(false);
  });

  it("notices a duplicated row on either side", () => {
    const base = [entry("p1", "f1"), entry("p2", "f2")];
    const doubled = [entry("p1", "f1"), entry("p1", "f1")];
    expect(propertyMapEqual(base, doubled)).toBe(false);
    expect(propertyMapEqual(doubled, base)).toBe(false);
  });

  it("notices a row mapped to a different property id", () => {
    expect(propertyMapEqual([entry("p1", "f1")], [entry("p2", "f1")])).toBe(
      false
    );
  });

  it("ignores the display fields a load refreshes from Onshape", () => {
    const stored: PropertyMapEntry[] = [
      {
        ...entry("p1", "f1"),
        onshapeName: "Vendor",
        valueType: "STRING"
      }
    ];
    const renamed: PropertyMapEntry[] = [
      {
        ...entry("p1", "f1"),
        onshapeName: "Supplier",
        valueType: "ENUM"
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
