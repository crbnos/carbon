// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationMaterial, OperationStep } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import {
  isBuiltLine,
  isTrackedLine,
  matchMaterialToScan,
  parseMaterials,
  parseSteps,
  recordForUnit,
  remainingToIssue,
  stepIsRecorded,
  unrecordedRequiredSteps
} from "./logic";

/**
 * The Materials and Instructions tabs.
 *
 * Both read a PASSTHROUGH field off the payload, so both have to tell "there
 * is nothing" apart from "this is not a shape I can read". Everything below is
 * a case where getting it wrong shows the operator an empty tab for a job that
 * has materials, or issues a quantity against the wrong part.
 */

const material = (over: Partial<OperationMaterial> = {}): OperationMaterial =>
  ({
    id: "m1",
    itemId: "i1",
    itemReadableId: "ABC-1",
    ...over
  }) as OperationMaterial;

const step = (over: Partial<OperationStep> = {}): OperationStep =>
  ({
    id: "s1",
    name: "Deburr",
    type: "Checkbox",
    sortOrder: 1,
    ...over
  }) as OperationStep;

describe("parseMaterials", () => {
  it("separates an empty list from an unreadable payload", () => {
    expect(parseMaterials(null)).toEqual({ materials: [], malformed: false });
    expect(parseMaterials([])).toEqual({ materials: [], malformed: false });
    // A shape this build cannot read is a BUG, and the tab says so rather than
    // rendering "No materials" for a job that has six.
    expect(parseMaterials("nonsense").malformed).toBe(true);
    expect(parseMaterials({ rows: [] }).malformed).toBe(true);
  });

  it("drops rows with no item and kit parents", () => {
    const { materials } = parseMaterials([
      material({ id: "a" }),
      // Nothing to name it and nothing to issue.
      material({ id: "b", itemId: null }),
      // A container whose children are the real lines: showing it would
      // double every quantity on screen.
      material({ id: "c", kit: true })
    ]);
    expect(materials.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps unknown extra columns rather than rejecting the row", () => {
    // The source is a VIEW that gains columns; a schema that rejected them
    // would take out the whole tab on a server one migration ahead.
    const { materials, malformed } = parseMaterials([
      { id: "a", itemId: "i1", somethingNew: 42 }
    ]);
    expect(malformed).toBe(false);
    expect(materials).toHaveLength(1);
  });
});

describe("matchMaterialToScan", () => {
  const materials = [
    material({ id: "a", itemReadableId: "ABC-1" }),
    material({ id: "b", itemReadableId: "ABC-10" }),
    material({
      id: "c",
      itemReadableId: "XYZ-5 Rev B",
      itemReadableIdWithoutRevision: "XYZ-5"
    } as Partial<OperationMaterial>)
  ];

  it("matches a readable id regardless of case and padding", () => {
    expect(matchMaterialToScan(materials, "ABC-1")?.id).toBe("a");
    expect(matchMaterialToScan(materials, " abc-1 ")?.id).toBe("a");
  });

  it("does not prefix-match, which would issue the wrong part", () => {
    // This is the whole reason the match is exact: "ABC-1" must not resolve to
    // ABC-10, or a scan writes a ledger row against a part that was never
    // touched.
    expect(matchMaterialToScan(materials, "ABC-1")?.id).toBe("a");
    expect(matchMaterialToScan(materials, "ABC-10")?.id).toBe("b");
    expect(matchMaterialToScan(materials, "ABC")).toBeNull();
  });

  it("accepts a label printed before a revision bump", () => {
    expect(matchMaterialToScan(materials, "XYZ-5")?.id).toBe("c");
  });

  it("is null for a code that is on no line", () => {
    expect(matchMaterialToScan(materials, "QQQ-9")).toBeNull();
    expect(matchMaterialToScan(materials, "  ")).toBeNull();
    expect(matchMaterialToScan([], "ABC-1")).toBeNull();
  });
});

describe("remainingToIssue", () => {
  it("is the shortfall, floored at zero", () => {
    expect(
      remainingToIssue(material({ estimatedQuantity: 10, quantityIssued: 4 }))
    ).toBe(6);
    // Over-issuing happens; a negative default would put "-2" in the keypad.
    expect(
      remainingToIssue(material({ estimatedQuantity: 10, quantityIssued: 12 }))
    ).toBe(0);
    expect(remainingToIssue(material())).toBe(0);
  });
});

describe("isBuiltLine / isTrackedLine", () => {
  it("recognises a line the job builds rather than consumes", () => {
    expect(isBuiltLine(material({ methodType: "Make to Order" }))).toBe(true);
    expect(isBuiltLine(material({ methodType: "Pull from Inventory" }))).toBe(
      false
    );
  });

  it("treats serial and batch tracking alike", () => {
    expect(isTrackedLine(material({ requiresSerialTracking: true }))).toBe(
      true
    );
    expect(isTrackedLine(material({ requiresBatchTracking: true }))).toBe(true);
    expect(isTrackedLine(material())).toBe(false);
  });
});

describe("parseSteps", () => {
  it("separates no instructions from an unreadable payload", () => {
    expect(parseSteps(null)).toEqual({ steps: [], malformed: false });
    expect(parseSteps({ attributes: [], parameters: [] }).malformed).toBe(
      false
    );
    expect(parseSteps("nonsense").malformed).toBe(true);
  });

  it("sorts by sortOrder, breaking ties stably", () => {
    // The server reads jobOperationStep with no ORDER BY, so the array arrives
    // in whatever order Postgres returned it. Work instructions shown out of
    // order are worse than none at all.
    const { steps } = parseSteps({
      attributes: [
        step({ id: "c", sortOrder: 2 }),
        step({ id: "a", sortOrder: 1 }),
        step({ id: "b", sortOrder: 1 })
      ],
      parameters: []
    });
    expect(steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("stepIsRecorded", () => {
  const withRecord = (record: Record<string, unknown>) =>
    step({
      jobOperationStepRecord: [
        { id: "r", jobOperationStepId: "s1", index: 0, ...record }
      ]
    } as Partial<OperationStep>);

  it("is false when the operator has recorded nothing", () => {
    expect(stepIsRecorded(step(), 0)).toBe(false);
    // The row exists because the operator UNCHECKED it. Treating the row's
    // existence as "done" would tick a step that was deliberately undone.
    expect(stepIsRecorded(withRecord({ booleanValue: false }), 0)).toBe(false);
    expect(stepIsRecorded(withRecord({ value: "" }), 0)).toBe(false);
    expect(stepIsRecorded(withRecord({ value: "   " }), 0)).toBe(false);
  });

  it("is true for any real recorded value", () => {
    expect(stepIsRecorded(withRecord({ booleanValue: true }), 0)).toBe(true);
    expect(stepIsRecorded(withRecord({ value: "ok" }), 0)).toBe(true);
    // Zero is a measurement, not an absence — a recorded 0.0 mm is a result.
    expect(stepIsRecorded(withRecord({ numericValue: 0 }), 0)).toBe(true);
    expect(stepIsRecorded(withRecord({ userValue: "u1" }), 0)).toBe(true);
  });

  it("is per unit", () => {
    // A serial operation making five parts records each step five times; unit
    // 1 being done says nothing about unit 0.
    const s = withRecord({ booleanValue: true });
    expect(stepIsRecorded(s, 0)).toBe(true);
    expect(stepIsRecorded(s, 1)).toBe(false);
  });
});

describe("recordForUnit / unrecordedRequiredSteps", () => {
  it("finds the record belonging to one unit", () => {
    const s = step({
      jobOperationStepRecord: [
        { id: "r0", jobOperationStepId: "s1", index: 0, value: "a" },
        { id: "r1", jobOperationStepId: "s1", index: 1, value: "b" }
      ]
    } as Partial<OperationStep>);
    expect(recordForUnit(s, 1)?.id).toBe("r1");
    expect(recordForUnit(s, 2)).toBeUndefined();
  });

  it("lists only the REQUIRED steps still outstanding", () => {
    const steps = [
      step({ id: "a", required: true }),
      step({ id: "b", required: false }),
      step({
        id: "c",
        required: true,
        jobOperationStepRecord: [
          { id: "r", jobOperationStepId: "c", index: 0, booleanValue: true }
        ]
      } as Partial<OperationStep>)
    ];
    expect(unrecordedRequiredSteps(steps, 0).map((s) => s.id)).toEqual(["a"]);
  });
});
