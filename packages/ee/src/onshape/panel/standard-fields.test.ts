// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { StandardField } from "./standard-fields";
import {
  defaultTranslations,
  matchingUnit,
  onshapeValueOptions,
  repeatedTranslationRows,
  STANDARD_FIELDS,
  standardField,
  translateValue,
  translationErrors,
  untranslatedOptions
} from "./standard-fields";

const units = [
  { code: "EA", name: "Each" },
  { code: "KG", name: "Kilogram" }
];

function field(id: string): StandardField {
  const found = standardField(id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

describe("the target list", () => {
  it("holds the six item fields, each with a writer", () => {
    expect(STANDARD_FIELDS.map((entry) => [entry.id, entry.writer])).toEqual([
      ["mpn", "itemColumn"],
      ["replenishmentSystem", "itemMethod"],
      ["defaultMethodType", "itemMethod"],
      ["sourcingType", "itemMethod"],
      ["itemTrackingType", "itemTracking"],
      ["unitOfMeasureCode", "itemColumn"]
    ]);
  });
});

describe("defaultTranslations", () => {
  it("starts a fixed list with each Carbon value on both sides", () => {
    expect(defaultTranslations(field("replenishmentSystem"), "ENUM")).toEqual([
      { onshape: "Buy", carbon: "Buy" },
      { onshape: "Make", carbon: "Make" },
      { onshape: "Buy and Make", carbon: "Buy and Make" }
    ]);
  });

  it("starts a BOOL property with Yes and No, both No value", () => {
    expect(defaultTranslations(field("replenishmentSystem"), "BOOL")).toEqual([
      { onshape: "Yes", carbon: null },
      { onshape: "No", carbon: null }
    ]);
  });

  it("starts the unit and text fields with no rows", () => {
    expect(defaultTranslations(field("unitOfMeasureCode"), "STRING")).toEqual(
      []
    );
    expect(defaultTranslations(field("mpn"), "STRING")).toEqual([]);
  });

  it("starts a list with known options with a row for each option that names a Carbon value", () => {
    expect(
      defaultTranslations(field("replenishmentSystem"), "ENUM", [
        "Make",
        "buy",
        "Make or Buy",
        "Buy and Make"
      ])
    ).toEqual([
      { onshape: "Make", carbon: "Make" },
      { onshape: "buy", carbon: "Buy" },
      { onshape: "Buy and Make", carbon: "Buy and Make" }
    ]);
  });

  it("gives a list whose options name no Carbon value no rows", () => {
    expect(
      defaultTranslations(field("replenishmentSystem"), "ENUM", [
        "In progress",
        "Released"
      ])
    ).toEqual([]);
  });
});

describe("onshapeValueOptions", () => {
  it("lists Yes and No for a BOOL and an ENUM's own options", () => {
    expect(onshapeValueOptions("BOOL", undefined)).toEqual(["Yes", "No"]);
    expect(onshapeValueOptions("ENUM", ["A", "B"])).toEqual(["A", "B"]);
  });

  it("has none for free text or an ENUM whose options are unknown", () => {
    expect(onshapeValueOptions("STRING", ["A"])).toBeNull();
    expect(onshapeValueOptions("ENUM", undefined)).toBeNull();
    expect(onshapeValueOptions("ENUM", [])).toBeNull();
  });
});

describe("untranslatedOptions", () => {
  it("names the options no row matches", () => {
    expect(
      untranslatedOptions(
        field("replenishmentSystem"),
        ["Make", "Buy", "Make or Buy"],
        [
          { onshape: "make", carbon: "Make" },
          { onshape: "Buy", carbon: null }
        ],
        units
      )
    ).toEqual(["Make or Buy"]);
  });

  it("counts a unit's code or name as a match without a row", () => {
    expect(
      untranslatedOptions(
        field("unitOfMeasureCode"),
        ["Each", "KG", "Inch"],
        [],
        units
      )
    ).toEqual(["Inch"]);
  });
});

describe("translateValue", () => {
  const replenishment = field("replenishmentSystem");
  const rows = [
    { onshape: "Purchased", carbon: "Buy" },
    { onshape: "Made", carbon: "Make" },
    { onshape: "Either", carbon: null }
  ];
  const translate = (text: string | null, valueType = "ENUM") =>
    translateValue({
      field: replenishment,
      text,
      valueType,
      translations: rows,
      units
    });

  it("matches a row, ignoring case and the spaces at the two ends", () => {
    expect(translate("  purchased ")).toEqual({ ok: true, value: "Buy" });
    expect(translate("MADE")).toEqual({ ok: true, value: "Make" });
  });

  it("gives No value for a row set to it", () => {
    expect(translate("Either")).toEqual({ ok: true, value: null });
  });

  it("gives no value for an empty value, never a problem", () => {
    expect(translate(null)).toEqual({ ok: true, value: null });
    expect(translate("   ")).toEqual({ ok: true, value: null });
  });

  it("reports a value no row matches", () => {
    expect(translate("Outsourced")).toEqual({
      ok: false,
      reason: '"Outsourced" has no Carbon value'
    });
  });

  it("reads a BOOL value as the Yes or No a row names", () => {
    const translations = [
      { onshape: "Yes", carbon: "Buy" },
      { onshape: "No", carbon: null }
    ];
    const bool = (text: string) =>
      translateValue({
        field: replenishment,
        text,
        valueType: "BOOL",
        translations,
        units
      });
    expect(bool("true")).toEqual({ ok: true, value: "Buy" });
    expect(bool("false")).toEqual({ ok: true, value: null });
  });

  it("matches a unit by its code or its name", () => {
    const unit = (text: string) =>
      translateValue({
        field: field("unitOfMeasureCode"),
        text,
        valueType: "STRING",
        translations: [{ onshape: "pcs", carbon: "EA" }],
        units
      });
    expect(unit("pcs")).toEqual({ ok: true, value: "EA" });
    expect(unit("kg")).toEqual({ ok: true, value: "KG" });
    expect(unit("Kilogram")).toEqual({ ok: true, value: "KG" });
    expect(unit("Litre")).toEqual({
      ok: false,
      reason: '"Litre" has no Carbon value'
    });
  });

  it("takes a text field's value as it is", () => {
    expect(
      translateValue({
        field: field("mpn"),
        text: " SKF-6203 ",
        valueType: "STRING",
        translations: [],
        units
      })
    ).toEqual({ ok: true, value: "SKF-6203" });
  });
});

describe("translationErrors", () => {
  it("accepts the field's own values and No value", () => {
    expect(
      translationErrors(
        field("sourcingType"),
        [
          { onshape: "Drop", carbon: "Drop Ship" },
          { onshape: "Stock", carbon: null }
        ],
        units
      )
    ).toEqual([]);
  });

  it("refuses a value outside the list, a blank row and a repeated row", () => {
    expect(
      translationErrors(
        field("itemTrackingType"),
        [
          { onshape: "Lot", carbon: "Lot" },
          { onshape: " ", carbon: "Batch" },
          { onshape: "Serial", carbon: "Serial" },
          { onshape: "serial ", carbon: "Serial" }
        ],
        units
      )
    ).toEqual([
      '"Lot" is not a Tracking Type value in Carbon',
      "A translation row has no Onshape value",
      '"serial" has two rows'
    ]);
  });

  it("checks a unit row against the company's units", () => {
    expect(
      translationErrors(
        field("unitOfMeasureCode"),
        [{ onshape: "pcs", carbon: "PC" }],
        units
      )
    ).toEqual(['"PC" is not a Unit of Measure value in Carbon']);
  });
});

describe("repeatedTranslationRows", () => {
  it("flags a typed row that repeats an option or an earlier row, ignoring case and spaces", () => {
    expect(
      repeatedTranslationRows([
        { onshape: "Make", fixed: true },
        { onshape: "Buy", fixed: true },
        { onshape: " make ", fixed: false },
        { onshape: "Outsourced", fixed: false },
        { onshape: "OUTSOURCED", fixed: false },
        { onshape: "  ", fixed: false }
      ])
    ).toEqual([2, 4]);
  });

  it("flags nothing when every value is listed once", () => {
    expect(
      repeatedTranslationRows([
        { onshape: "Make", fixed: true },
        { onshape: "Purchased", fixed: false }
      ])
    ).toEqual([]);
  });
});

describe("matchingUnit", () => {
  it("matches a unit by code first, then by name", () => {
    expect(matchingUnit("kg", units)).toEqual({
      unit: { code: "KG", name: "Kilogram" },
      by: "code"
    });
    expect(matchingUnit(" each ", units)).toEqual({
      unit: { code: "EA", name: "Each" },
      by: "name"
    });
    expect(matchingUnit("Inch", units)).toBeNull();
  });
});
