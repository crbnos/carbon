import { describe, expect, it } from "vitest";
import {
  checkMaterialProperties,
  clearsSubstanceOrShape,
  generateMaterialIdentity,
  materialItemUpdateFields,
  type MaterialPropertyLookups,
  type MaterialPropertyValues,
  noMaterialProperties,
  resolveMaterialProperties,
  sentMaterialProperties
} from "~/modules/items/material-properties";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";

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

  it("ignores a sent name, which is derived instead", () => {
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

describe("material tools over MCP", () => {
  const tools = (
    toolMetadataJson as unknown as {
      tools: { name: string; injectAuth: string[]; serviceParams: string[] }[];
    }
  ).tools;
  const tool = (name: string) => tools.find((t) => t.name === name);

  it.each([
    "items_upsertMaterialDimension",
    "items_upsertMaterialFinish",
    "items_upsertMaterialGrade",
    "items_upsertMaterialType"
  ])("%s stamps no audit columns its table lacks", (name) => {
    expect(tool(name)?.injectAuth).toEqual(["companyId"]);
  });

  it("items_updateMaterialProperties is reachable with a database client", () => {
    const update = tool("items_updateMaterialProperties");
    expect(update?.serviceParams).toEqual(["client", "db", "material"]);
    expect(update?.injectAuth).toEqual(
      expect.arrayContaining(["companyId", "updatedBy"])
    );
  });
});
