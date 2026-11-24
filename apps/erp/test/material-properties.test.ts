// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  checkMaterialProperties,
  clearsSubstanceOrShape,
  generatedMaterialUpdateRefusal,
  generateMaterialIdentity,
  materialItemUpdateFields,
  type MaterialPropertyLookups,
  type MaterialPropertyValues,
  newMaterialIdentity,
  newMaterialRevisions,
  noMaterialProperties,
  resolveMaterialProperties,
  sentMaterialProperties
} from "~/modules/items/material-properties";

// The properties panel's rules for material edits, which upsertMaterial,
// updateMaterialProperties (MCP) and the panel's own route all apply.

const ALUMINUM_PLATE: MaterialPropertyValues = {
  materialSubstanceId: "aluminum",
  materialFormId: "plate",
  materialTypeId: "al-pl-cast",
  finishId: "al-anodized",
  gradeId: "al-6061",
  dimensionId: "pl-025"
};

const aluminum = { name: "Aluminum", code: "AL" };
const plate = { name: "Plate", code: "PL" };

/** Lookups for ALUMINUM_PLATE, overridable per test. */
function lookupsFor(
  overrides: Partial<MaterialPropertyLookups> = {}
): MaterialPropertyLookups {
  return {
    substance: aluminum,
    form: plate,
    type: {
      name: "Cast",
      code: "C",
      materialSubstanceId: "aluminum",
      materialFormId: "plate"
    },
    finish: { name: "Anodized", materialSubstanceId: "aluminum" },
    grade: { name: "6061", materialSubstanceId: "aluminum" },
    dimension: { name: '1/4"', materialFormId: "plate" },
    ...overrides
  };
}

describe("resolveMaterialProperties", () => {
  it("a new substance clears finish, grade and type, not dimension", () => {
    const { next, changed } = resolveMaterialProperties(ALUMINUM_PLATE, {
      materialSubstanceId: "steel"
    });
    expect(changed).toEqual({
      materialSubstanceId: "steel",
      finishId: null,
      gradeId: null,
      materialTypeId: null
    });
    expect(next.dimensionId).toBe("pl-025");
  });

  it("keeps a dependent the same change sets", () => {
    const { changed } = resolveMaterialProperties(ALUMINUM_PLATE, {
      materialSubstanceId: "steel",
      gradeId: "stl-1018"
    });
    expect(changed).toMatchObject({ gradeId: "stl-1018", finishId: null });
  });

  it("a new shape clears dimension and type, not grade", () => {
    const { changed } = resolveMaterialProperties(ALUMINUM_PLATE, {
      materialFormId: "roundBar"
    });
    expect(changed).toEqual({
      materialFormId: "roundBar",
      dimensionId: null,
      materialTypeId: null
    });
  });

  it("echoing the current values changes nothing", () => {
    expect(
      resolveMaterialProperties(ALUMINUM_PLATE, { ...ALUMINUM_PLATE }).changed
    ).toEqual({});
  });
});

describe("checkMaterialProperties", () => {
  const check = (
    changes: Partial<MaterialPropertyValues>,
    overrides: Partial<MaterialPropertyLookups> = {},
    current = ALUMINUM_PLATE
  ) => {
    const { next } = resolveMaterialProperties(current, changes);
    return checkMaterialProperties(current, next, lookupsFor(overrides));
  };

  it("accepts picks from the substance's and shape's lists", () => {
    expect(
      check(
        { gradeId: "al-7075" },
        { grade: { name: "7075", materialSubstanceId: "aluminum" } }
      )
    ).toBeNull();
  });

  it.each([
    [
      { gradeId: "stl-1018" },
      { grade: { name: "1018", materialSubstanceId: "steel" } },
      "Grade 1018 (stl-1018) is not a grade of substance Aluminum (aluminum)"
    ],
    [
      { finishId: "stl-black" },
      { finish: { name: "Black oxide", materialSubstanceId: "steel" } },
      "Finish Black oxide (stl-black) is not a finish of substance Aluminum"
    ],
    [
      { dimensionId: "rb-1" },
      { dimension: { name: '1"', materialFormId: "roundBar" } },
      'Dimension 1" (rb-1) is not a dimension of shape Plate (plate)'
    ],
    [
      { materialFormId: "roundBar", materialTypeId: "al-pl-cast" },
      { form: { name: "Round Bar", code: "RB" } },
      "Type Cast (al-pl-cast) is not a type of substance Aluminum (aluminum) and shape Round Bar (roundBar)"
    ],
    [{ finishId: "missing" }, { finish: null }, "Finish missing not found"],
    [
      { materialSubstanceId: "unobtainium" },
      { substance: null },
      "Substance unobtainium not found"
    ]
  ] as const)("refuses %o", (changes, overrides, message) => {
    expect(check(changes, overrides)).toContain(message);
  });

  it("re-checks a kept dependent against a new parent", () => {
    expect(
      check(
        { materialSubstanceId: "steel", gradeId: "al-6061" },
        { substance: { name: "Steel", code: "STL" } }
      )
    ).toContain("is not a grade of substance Steel (steel)");
  });

  it("leaves an older inconsistency alone when the change is elsewhere", () => {
    const current = { ...ALUMINUM_PLATE, gradeId: "stl-1018" };
    expect(
      check(
        { dimensionId: null },
        { grade: { name: "1018", materialSubstanceId: "steel" } },
        current
      )
    ).toBeNull();
  });

  it("a grade needs a substance", () => {
    expect(
      check(
        { gradeId: "al-6061" },
        { substance: null },
        noMaterialProperties
      )
    ).toContain("is not a grade of no substance");
  });
});

describe("generated material IDs", () => {
  it("builds the readable id from codes and the name from names", () => {
    expect(generateMaterialIdentity(ALUMINUM_PLATE, lookupsFor())).toEqual({
      readableId: '6061-AL-C-PL-1/4"-Anodized',
      name: '6061 Aluminum Cast Plate 1/4" Anodized'
    });
  });

  it("waits for both a substance and a shape", () => {
    const substanceOnly = {
      ...noMaterialProperties,
      materialSubstanceId: "aluminum"
    };
    expect(
      generateMaterialIdentity(substanceOnly, lookupsFor({ form: null }))
    ).toBeNull();
  });

  it("leaves the name out of the item update of a call that derives it", () => {
    expect(materialItemUpdateFields(true)).not.toContain("name");
    expect(materialItemUpdateFields(false)).toContain("name");
  });

  it("refuses clearing a substance or shape that is set, not setting one", () => {
    expect(
      clearsSubstanceOrShape(ALUMINUM_PLATE, {
        ...ALUMINUM_PLATE,
        materialFormId: null
      })
    ).toBe(true);
    expect(
      clearsSubstanceOrShape(noMaterialProperties, {
        ...noMaterialProperties,
        materialSubstanceId: "aluminum"
      })
    ).toBe(false);
  });
});

describe("newMaterialIdentity", () => {
  // An API create mirrors the New Material form, which has no ID or name
  // field under generated IDs and requires both when IDs are typed.
  const derived = { readableId: "6061-AL-PL", name: "6061 Aluminum Plate" };

  it("takes the derived ID and name when none or the same are sent", () => {
    expect(newMaterialIdentity(derived, {})).toEqual(derived);
    expect(
      newMaterialIdentity(derived, {
        id: "6061-AL-PL",
        name: "6061 Aluminum Plate"
      })
    ).toEqual(derived);
  });

  it.each([
    { id: "AL-SHEET" },
    { name: "Aluminum sheet" }
  ])("refuses %o when it differs from the derived value", (sent) => {
    expect(newMaterialIdentity(derived, sent)).toMatchObject({
      refusal: "rule"
    });
  });

  it("requires both an ID and a name when IDs are typed", () => {
    expect(
      newMaterialIdentity(null, { id: "AL-SHEET", name: "Aluminum sheet" })
    ).toEqual({ readableId: "AL-SHEET", name: "Aluminum sheet" });
    expect(newMaterialIdentity(null, { name: "Aluminum sheet" })).toMatchObject(
      { refusal: "validation" }
    );
    expect(newMaterialIdentity(null, { id: "AL-SHEET" })).toMatchObject({
      refusal: "validation"
    });
  });
});

describe("newMaterialRevisions", () => {
  it.each([
    [undefined, ["0"]],
    [[], ["0"]],
    [[""], ["0"]],
    [["A", "A"], ["A"]],
    [["A", "", "B", "A"], ["A", "B"]]
  ])("makes %o one revision per distinct size: %o", (sizes, revisions) => {
    expect(newMaterialRevisions(sizes)).toEqual(revisions);
  });
});

describe("generatedMaterialUpdateRefusal", () => {
  // An API update mirrors the properties panel under generated IDs: no ID
  // field, and a name field whose value a property change replaces.
  const derived = { readableId: "6061-AL-SH", name: "6061 Aluminum Sheet" };

  it("lets a call that changes no property set any name", () => {
    expect(
      generatedMaterialUpdateRefusal("6061-AL-PL", null, {
        name: "Plate offcuts"
      })
    ).toBeNull();
  });

  it("lets a property change through with no name, or the derived one", () => {
    expect(generatedMaterialUpdateRefusal("6061-AL-PL", derived, {})).toBeNull();
    expect(
      generatedMaterialUpdateRefusal("6061-AL-PL", derived, {
        readableId: "6061-AL-SH",
        name: "6061 Aluminum Sheet"
      })
    ).toBeNull();
  });

  it.each([
    ["a name the change does not derive", derived, { name: "Plate offcuts" }],
    ["an ID the change does not derive", derived, { readableId: "AL-SHEET" }],
    ["another ID with no property change", null, { readableId: "AL-SHEET" }]
  ])("refuses %s", (_case, generated, sent) => {
    expect(
      generatedMaterialUpdateRefusal("6061-AL-PL", generated, sent)
    ).toEqual(expect.any(String));
  });
});

describe("sentMaterialProperties", () => {
  it("absent keeps, undefined, null and empty string clear", () => {
    const payload = {
      gradeId: undefined,
      finishId: null,
      dimensionId: "",
      materialFormId: "plate",
      name: "ignored"
    };
    expect(sentMaterialProperties(payload)).toEqual({
      gradeId: null,
      finishId: null,
      dimensionId: null,
      materialFormId: "plate"
    });
  });
});
