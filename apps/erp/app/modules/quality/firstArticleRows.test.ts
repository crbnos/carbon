import { describe, expect, it } from "vitest";
import type {
  FirstArticleFeature,
  FirstArticleMeasurement
} from "./firstArticleRows";
import {
  buildForm3Rows,
  duplicateNumbers,
  formatRequirement,
  formatResults,
  indexPartType
} from "./firstArticleRows";

function feature(
  overrides: Partial<FirstArticleFeature> = {}
): FirstArticleFeature {
  return {
    id: "f1",
    label: "1",
    description: null,
    type: "Measurement",
    nominalValue: "10.000",
    tolerancePlus: "0.005",
    toleranceMinus: "0.005",
    unit: "mm",
    designator: null,
    referenceLocation: null,
    materialCondition: null,
    sizeFeatureId: null,
    ...overrides
  };
}

function reading(
  overrides: Partial<FirstArticleMeasurement> = {}
): FirstArticleMeasurement {
  return {
    value: 10.002,
    status: "Passed",
    bonus: null,
    allowable: null,
    notes: null,
    ...overrides
  };
}

describe("formatRequirement", () => {
  it("prints an equal tolerance as ±", () => {
    expect(formatRequirement(feature())).toBe("10.000 ±0.005 mm");
  });

  it("prints an asymmetric tolerance as +plus/-minus", () => {
    expect(
      formatRequirement(
        feature({ tolerancePlus: "+0.010", toleranceMinus: "-0.000" })
      )
    ).toBe("10.000 +0.010/-0.000 mm");
  });

  it("marks a geometric tolerance at MMC or LMC", () => {
    expect(
      formatRequirement(
        feature({
          nominalValue: "0",
          tolerancePlus: "0.25",
          toleranceMinus: null,
          unit: null,
          materialCondition: "MMC"
        })
      )
    ).toBe("0 +0.25/-0 Ⓜ");
    expect(
      formatRequirement(feature({ materialCondition: "LMC", unit: null }))
    ).toBe("10.000 ±0.005 Ⓛ");
  });

  it("describes a non-numeric row by its text", () => {
    expect(
      formatRequirement(
        feature({
          type: "Checkbox",
          description: "Deburr all edges",
          nominalValue: null
        })
      )
    ).toBe("Deburr all edges");
    expect(
      formatRequirement(
        feature({ type: "Checkbox", description: null, nominalValue: null })
      )
    ).toBe("1");
  });
});

describe("formatResults", () => {
  it("is empty without a reading or with a pending one", () => {
    expect(formatResults(feature(), undefined, null)).toBeNull();
    expect(
      formatResults(feature(), reading({ status: "Pending" }), null)
    ).toBeNull();
  });

  it("prints a numeric value", () => {
    expect(formatResults(feature(), reading(), null)).toBe("10.002");
  });

  it("prints Accept or Reject for an attribute row", () => {
    const attribute = feature({ type: "Checkbox", nominalValue: null });
    expect(
      formatResults(attribute, reading({ value: null, status: "Passed" }), null)
    ).toBe("Accept");
    expect(
      formatResults(attribute, reading({ value: null, status: "Failed" }), null)
    ).toBe("Reject");
  });

  const position = feature({
    id: "pos",
    label: "7",
    nominalValue: "0",
    tolerancePlus: "0.25",
    toleranceMinus: "0",
    materialCondition: "MMC",
    sizeFeatureId: "size"
  });

  it("explains a pass that needed its bonus tolerance", () => {
    expect(
      formatResults(
        position,
        reading({ value: 0.3, bonus: 0.1, allowable: 0.35 }),
        "4"
      )
    ).toBe("0.3 — Accept with MMC (bonus 0.1, allowable 0.35; size #4)");
  });

  it("says nothing about the bonus when the stated tolerance was enough", () => {
    expect(
      formatResults(
        position,
        reading({ value: 0.2, bonus: 0.1, allowable: 0.35 }),
        "4"
      )
    ).toBe("0.2");
  });

  it("appends the reading's note", () => {
    expect(
      formatResults(feature(), reading({ notes: "Lab report LR-2231" }), null)
    ).toBe("10.002 — Lab report LR-2231");
  });
});

describe("buildForm3Rows", () => {
  const features = [
    feature({ id: "a", label: "10" }),
    feature({ id: "b", label: "2" }),
    feature({ id: "c", label: "1" })
  ];

  it("sorts characteristic numbers numerically", () => {
    const rows = buildForm3Rows(features, new Map(), null);
    expect(rows.map((row) => row.characteristicNumber)).toEqual([
      "1",
      "2",
      "10"
    ]);
    expect(rows.every((row) => row.status === "Pending")).toBe(true);
  });

  it("prints the NCR number only on failed rows", () => {
    const rows = buildForm3Rows(
      features,
      new Map([
        ["a", reading({ value: 11, status: "Failed", notes: "Re-measured" })],
        ["b", reading()]
      ]),
      "NCR000012"
    );
    const byNumber = new Map(
      rows.map((row) => [row.characteristicNumber, row])
    );
    expect(byNumber.get("10")?.nonconformanceNumber).toBe("NCR000012");
    expect(byNumber.get("10")?.notes).toBe("Re-measured");
    expect(byNumber.get("2")?.nonconformanceNumber).toBeNull();
    expect(byNumber.get("1")?.results).toBeNull();
  });

  it("finds duplicated characteristic numbers", () => {
    const rows = buildForm3Rows(
      [
        feature({ id: "a", label: "3" }),
        feature({ id: "b", label: "3" }),
        feature({ id: "c", label: "12" }),
        feature({ id: "d", label: "12" }),
        feature({ id: "e", label: "4" })
      ],
      new Map(),
      null
    );
    expect(duplicateNumbers(rows)).toEqual(["3", "12"]);
  });
});

describe("indexPartType", () => {
  it("leaves raw materials to Form 2", () => {
    expect(
      indexPartType({ itemType: "Material", methodType: "Pull from Inventory" })
    ).toBeNull();
  });

  it("indexes a made child as a sub-assembly", () => {
    expect(
      indexPartType({ itemType: "Part", methodType: "Make to Order" })
    ).toBe("Sub-assembly");
  });

  it("indexes a bought part as COTS", () => {
    expect(
      indexPartType({ itemType: "Part", methodType: "Purchase to Order" })
    ).toBe("COTS");
    expect(
      indexPartType({ itemType: "Part", methodType: "Pull from Inventory" })
    ).toBe("COTS");
  });
});
