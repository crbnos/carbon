// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type AssemblyMaterial,
  type AssemblyStep,
  completedUnits,
  containmentWithoutStep,
  deriveUnits,
  firstIncompleteStep,
  isStepBadResult,
  isStepDone,
  issuedForUnit,
  isUnitBuilt,
  isUnitIncompleteForOperation,
  materialStates,
  maxNavigableUnitIndex,
  nextIncompleteUnit,
  parseMeasurement,
  pendingScans,
  recordedDisplay,
  resolveUnitIndex,
  shouldAutoCompleteUnit,
  sortSteps,
  stepChipState,
  stepTools,
  unissuedTrackedParts,
  unitCount,
  unitHasBadResult,
  unitIsRecorded,
  unitRemainingToIssue,
  visibleMaterials
} from "./logic";

const step = (
  id: string,
  over: Partial<AssemblyStep> = {},
  records: { index: number; [key: string]: unknown }[] = []
): AssemblyStep => ({
  id,
  name: id,
  type: "Task",
  sortOrder: 0,
  jobOperationStepRecord: records.map((r, i) => ({ id: `${id}-r${i}`, ...r })),
  ...over
});

const part = (over: Partial<AssemblyMaterial> = {}): AssemblyMaterial => ({
  id: "m1",
  itemType: "Part",
  quantity: 1,
  quantityIssued: 0,
  jobOperationStepIds: [],
  ...over
});

describe("unitCount", () => {
  it("is the operation quantity, whole", () => {
    expect(unitCount(10, 0)).toBe(10);
    // The real board has an operation for 4.5; web pages five units for it.
    expect(unitCount(4.5, 0)).toBe(5);
    expect(unitCount(4.4, 0)).toBe(4);
  });

  it("is never less than one, so a screen always has a unit", () => {
    expect(unitCount(0, 0)).toBe(1);
    expect(unitCount(Number.NaN, 0)).toBe(1);
    expect(unitCount(-3, 0)).toBe(1);
  });

  it("falls back to the tracked entities when there is no quantity", () => {
    expect(unitCount(null, 6)).toBe(6);
    expect(unitCount(undefined, 0)).toBe(1);
  });
});

describe("deriveUnits", () => {
  it("binds a serial per unit", () => {
    const units = deriveUnits(3, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(units.map((u) => u.entity?.id)).toEqual(["a", "b", "c"]);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2]);
  });

  it("ignores serials pre-generated beyond the quantity", () => {
    expect(
      deriveUnits(2, [{ id: "a" }, { id: "b" }, { id: "c" }])
    ).toHaveLength(2);
  });

  it("leaves surplus units unbound", () => {
    // A batch parent: one lot for unit 0, none for the rest.
    const units = deriveUnits(3, [{ id: "lot" }]);
    expect(units.map((u) => u.entity?.id ?? null)).toEqual(["lot", null, null]);
  });

  it("binds nothing for an untracked parent", () => {
    expect(deriveUnits(2, []).every((u) => u.entity === null)).toBe(true);
    expect(deriveUnits(2, null).every((u) => u.entity === null)).toBe(true);
  });
});

describe("isUnitIncompleteForOperation", () => {
  it("is complete once it carries this operation's marker", () => {
    expect(
      isUnitIncompleteForOperation(
        { id: "a", status: "Available", attributes: { "Operation op1": true } },
        "op1"
      )
    ).toBe(false);
  });

  it("ignores another operation's marker", () => {
    expect(
      isUnitIncompleteForOperation(
        { id: "a", status: "Available", attributes: { "Operation op2": true } },
        "op1"
      )
    ).toBe(true);
  });

  it("is complete when the unit has left the flow", () => {
    expect(
      isUnitIncompleteForOperation({ id: "a", status: "Consumed" }, "op1")
    ).toBe(false);
    expect(
      isUnitIncompleteForOperation({ id: "a", status: "Scrapped" }, "op1")
    ).toBe(false);
  });

  it("keeps a rejected unit open, unlike the inspection screen", () => {
    // A rejected unit can still be reworked through this operation.
    expect(
      isUnitIncompleteForOperation({ id: "a", status: "Rejected" }, "op1")
    ).toBe(true);
  });

  it("treats a marker with a falsy value as a marker", () => {
    // The server's rule is the KEY's presence (`in`), not its truthiness.
    expect(
      isUnitIncompleteForOperation(
        { id: "a", attributes: { "Operation op1": null } },
        "op1"
      )
    ).toBe(false);
  });
});

describe("resolveUnitIndex", () => {
  const units = deriveUnits(4, [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" }
  ]);

  it("follows the tracked entity for a serial parent", () => {
    expect(
      resolveUnitIndex({
        units,
        navigatesByEntity: true,
        trackedEntityId: "c",
        unitParam: 0,
        quantityComplete: 0
      })
    ).toBe(2);
  });

  it("ignores the entity for a parent that does not navigate by one", () => {
    // A batch parent shares one lot across every unit; it pages by index.
    expect(
      resolveUnitIndex({
        units,
        navigatesByEntity: false,
        trackedEntityId: "c",
        unitParam: 1,
        quantityComplete: 0
      })
    ).toBe(1);
  });

  it("falls back to an explicit unit when the entity is not on the axis", () => {
    expect(
      resolveUnitIndex({
        units,
        navigatesByEntity: true,
        trackedEntityId: "zzz",
        unitParam: 3,
        quantityComplete: 0
      })
    ).toBe(3);
  });

  it("refuses an out-of-range unit", () => {
    for (const unitParam of [-1, 4, 1.5, Number.NaN]) {
      expect(
        resolveUnitIndex({
          units,
          navigatesByEntity: false,
          trackedEntityId: null,
          unitParam,
          quantityComplete: 2
        })
      ).toBe(2);
    }
  });

  it("lands on the next unit still to build, not on unit one", () => {
    expect(
      resolveUnitIndex({
        units,
        navigatesByEntity: false,
        trackedEntityId: null,
        unitParam: null,
        quantityComplete: 2
      })
    ).toBe(2);
  });

  it("stays on the last unit once everything is built", () => {
    expect(
      resolveUnitIndex({
        units,
        navigatesByEntity: false,
        trackedEntityId: null,
        unitParam: null,
        quantityComplete: 9
      })
    ).toBe(3);
  });
});

describe("step state", () => {
  it("counts a record row as done, whatever it holds", () => {
    // A failed inspection is done-and-bad, not undone.
    const failed = step("s", { type: "Inspection" }, [
      { index: 0, booleanValue: false }
    ]);
    expect(isStepDone(failed, 0)).toBe(true);
    expect(isStepBadResult(failed, 0)).toBe(true);
  });

  it("keeps each unit's records to itself", () => {
    const s = step("s", {}, [{ index: 1, booleanValue: true }]);
    expect(isStepDone(s, 0)).toBe(false);
    expect(isStepDone(s, 1)).toBe(true);
  });

  it("flags a measurement outside its limits", () => {
    const measured = (numericValue: number) =>
      step("s", { type: "Measurement", minValue: 1, maxValue: 2 }, [
        { index: 0, numericValue }
      ]);
    expect(isStepBadResult(measured(0.9), 0)).toBe(true);
    expect(isStepBadResult(measured(2.1), 0)).toBe(true);
    // The limits themselves pass.
    expect(isStepBadResult(measured(1), 0)).toBe(false);
    expect(isStepBadResult(measured(2), 0)).toBe(false);
  });

  it("applies only the limit that is set", () => {
    const s = step("s", { type: "Measurement", minValue: 1, maxValue: null }, [
      { index: 0, numericValue: 999 }
    ]);
    expect(isStepBadResult(s, 0)).toBe(false);
  });

  it("never calls an unrecorded step bad", () => {
    expect(
      isStepBadResult(step("s", { type: "Measurement", minValue: 1 }), 0)
    ).toBe(false);
  });

  it("rolls up to the unit", () => {
    const steps = [
      step("a", {}, [{ index: 0, booleanValue: true }]),
      step("b", { type: "Inspection" }, [{ index: 0, booleanValue: false }])
    ];
    expect(unitIsRecorded(steps, 0)).toBe(true);
    expect(unitHasBadResult(steps, 0)).toBe(true);
    expect(unitIsRecorded(steps, 1)).toBe(false);
    expect(firstIncompleteStep(steps, 1)).toBe(0);
    expect(firstIncompleteStep(steps, 0)).toBe(-1);
  });

  it("does not call a unit recorded when there are no steps", () => {
    // An operation with no steps is completed by hand, never automatically.
    expect(unitIsRecorded([], 0)).toBe(false);
  });

  it("sorts by sort order without mutating", () => {
    const input = [step("b", { sortOrder: 2 }), step("a", { sortOrder: 1 })];
    expect(sortSteps(input).map((s) => s.id)).toEqual(["a", "b"]);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("recordedDisplay", () => {
  it("shows a number with its unit", () => {
    expect(
      recordedDisplay(step("s", { unitOfMeasureCode: "Nm" }), {
        id: "r",
        index: 0,
        numericValue: 12.5
      })
    ).toBe("12.5 Nm");
  });

  it("shows yes or no, a value, then a person", () => {
    const s = step("s");
    expect(recordedDisplay(s, { id: "r", index: 0, booleanValue: true })).toBe(
      "Yes"
    );
    expect(recordedDisplay(s, { id: "r", index: 0, booleanValue: false })).toBe(
      "No"
    );
    expect(recordedDisplay(s, { id: "r", index: 0, value: "Blue" })).toBe(
      "Blue"
    );
    expect(recordedDisplay(s, { id: "r", index: 0, userValue: "u_1" })).toBe(
      "u_1"
    );
    expect(recordedDisplay(s, { id: "r", index: 0 })).toBeNull();
  });

  it("shows a file by its name, not its storage path", () => {
    expect(
      recordedDisplay(step("s", { type: "File" }), {
        id: "r",
        index: 0,
        value: "co_1/job/op/photo.jpg"
      })
    ).toBe("photo.jpg");
  });
});

describe("visibleMaterials", () => {
  const steps = [step("s1"), step("s2")];
  const assigned = part({ id: "assigned", jobOperationStepIds: ["s2"] });
  const general = part({ id: "general" });

  it("shows a part only on the step it is assigned to", () => {
    expect(visibleMaterials([assigned], steps[0] ?? null, 0)).toEqual([]);
    expect(
      visibleMaterials([assigned], steps[1] ?? null, 1).map((m) => m.id)
    ).toEqual(["assigned"]);
  });

  it("shows unassigned parts on the first step only", () => {
    expect(
      visibleMaterials([general], steps[0] ?? null, 0).map((m) => m.id)
    ).toEqual(["general"]);
    expect(visibleMaterials([general], steps[1] ?? null, 1)).toEqual([]);
  });

  it("shows unassigned parts when the operation has no steps at all", () => {
    // The real case on the test board: parts and tools, "No steps defined".
    expect(visibleMaterials([general], null, 0).map((m) => m.id)).toEqual([
      "general"
    ]);
  });

  it("puts assigned parts first, then orders by item type", () => {
    const onFirst = part({ id: "on-step", jobOperationStepIds: ["s1"] });
    const consumable = part({ id: "consumable", itemType: "Consumable" });
    const unknown = part({ id: "unknown", itemType: "Whatever" });
    expect(
      visibleMaterials(
        [unknown, consumable, general, onFirst],
        steps[0] ?? null,
        0
      ).map((m) => m.id)
    ).toEqual(["on-step", "general", "consumable", "unknown"]);
  });
});

describe("stepTools", () => {
  it("shows a linked tool on its steps and an unlinked one everywhere", () => {
    const everywhere = { id: "wrench", jobOperationStepIds: [] };
    const linked = { id: "jig", jobOperationStepIds: ["s2"] };
    expect(
      stepTools([everywhere, linked], step("s1")).map((t) => t.id)
    ).toEqual(["wrench"]);
    expect(
      stepTools([everywhere, linked], step("s2")).map((t) => t.id)
    ).toEqual(["wrench", "jig"]);
    expect(stepTools([everywhere, linked], null).map((t) => t.id)).toEqual([
      "wrench"
    ]);
  });
});

describe("issuedForUnit", () => {
  it("derives a unit's share of a job-wide total", () => {
    // 2 per unit, 5 issued in all: units 0 and 1 are full, unit 2 has one.
    const m = part({ quantity: 2, quantityIssued: 5 });
    const at = (unitIndex: number) =>
      issuedForUnit(m, { unitIndex, issuedIsPerUnit: false });
    expect(at(0)).toEqual({ required: 2, issued: 2, fullyIssued: true });
    expect(at(1)).toEqual({ required: 2, issued: 2, fullyIssued: true });
    expect(at(2)).toEqual({ required: 2, issued: 1, fullyIssued: false });
    expect(at(3)).toEqual({ required: 2, issued: 0, fullyIssued: false });
  });

  it("takes a per-unit figure as it is", () => {
    expect(
      issuedForUnit(part({ quantity: 1, quantityIssued: 1 }), {
        unitIndex: 7,
        issuedIsPerUnit: true
      })
    ).toEqual({ required: 1, issued: 1, fullyIssued: true });
  });

  it("shows the raw total for an unplanned extra, which is never 'fully' issued", () => {
    expect(
      issuedForUnit(part({ quantity: 0, quantityIssued: 3 }), {
        unitIndex: 2,
        issuedIsPerUnit: false
      })
    ).toEqual({ required: 0, issued: 3, fullyIssued: false });
  });

  it("lets the override win", () => {
    expect(
      issuedForUnit(part({ quantity: 4, quantityIssued: 0 }), {
        unitIndex: 0,
        issuedIsPerUnit: false,
        issuedOverride: 4
      })
    ).toEqual({ required: 4, issued: 4, fullyIssued: true });
  });

  it("falls back to the estimated quantity", () => {
    expect(
      issuedForUnit(
        { quantity: null, estimatedQuantity: 3, quantityIssued: 0 },
        { unitIndex: 0, issuedIsPerUnit: false }
      ).required
    ).toBe(3);
  });
});

describe("materialStates", () => {
  it("flips a loose part to issued when the unit's first step is recorded", () => {
    const loose = part({ id: "loose", quantity: 2 });
    const before = materialStates({
      materials: [loose],
      steps: [step("s1")],
      stepIndex: 0,
      unitIndex: 0,
      parentIsTracked: false
    });
    expect(before[0]).toMatchObject({ issued: 0, fullyIssued: false });

    const after = materialStates({
      materials: [loose],
      steps: [step("s1", {}, [{ index: 0, booleanValue: true }])],
      stepIndex: 0,
      unitIndex: 0,
      parentIsTracked: false
    });
    expect(after[0]).toMatchObject({ issued: 2, fullyIssued: true });
  });

  it("does not flip it for another unit's record", () => {
    const states = materialStates({
      materials: [part({ quantity: 2 })],
      steps: [step("s1", {}, [{ index: 0, booleanValue: true }])],
      stepIndex: 0,
      unitIndex: 1,
      parentIsTracked: false
    });
    expect(states[0]?.issued).toBe(0);
  });

  it("shows a split line by this step's share", () => {
    // Ten screws: five on step one, five on step two.
    const screws = part({
      quantity: 10,
      jobOperationStepIds: ["s1", "s2"],
      jobOperationStepQuantities: { s1: 5, s2: 5 }
    });
    const states = materialStates({
      materials: [screws],
      steps: [step("s1", {}, [{ index: 0, booleanValue: true }]), step("s2")],
      stepIndex: 1,
      unitIndex: 0,
      parentIsTracked: false
    });
    // Step two is not recorded, so its five are not issued — even though step
    // one is, and the whole line would otherwise read as satisfied.
    expect(states[0]).toMatchObject({
      required: 5,
      issued: 0,
      stepNumbers: [1, 2]
    });
  });

  it("never auto-issues a tracked part: it has to be scanned", () => {
    const battery = part({
      quantity: 1,
      requiresSerialTracking: true,
      jobOperationStepIds: ["s1"]
    });
    const states = materialStates({
      materials: [battery],
      steps: [step("s1", {}, [{ index: 0, booleanValue: true }])],
      stepIndex: 0,
      unitIndex: 0,
      parentIsTracked: true
    });
    expect(states[0]).toMatchObject({
      isTracked: true,
      issued: 0,
      fullyIssued: false
    });
  });

  it("reads a tracked part's per-unit figure under a tracked parent", () => {
    const battery = part({
      quantity: 1,
      quantityIssued: 1,
      requiresSerialTracking: true
    });
    const states = materialStates({
      materials: [battery],
      steps: [],
      stepIndex: 0,
      // Under a job-wide reading unit 3 would have a share of zero.
      unitIndex: 3,
      parentIsTracked: true
    });
    expect(states[0]?.fullyIssued).toBe(true);
  });
});

describe("pendingScans", () => {
  it("gates on tracked parts that are short, and on nothing else", () => {
    const states = materialStates({
      materials: [
        part({ id: "scan-me", requiresSerialTracking: true }),
        part({ id: "scanned", requiresBatchTracking: true, quantityIssued: 1 }),
        part({ id: "loose" }),
        part({ id: "extra", requiresSerialTracking: true, quantity: 0 })
      ],
      steps: [],
      stepIndex: 0,
      unitIndex: 0,
      parentIsTracked: true
    });
    expect(pendingScans(states).map((s) => s.material.id)).toEqual(["scan-me"]);
  });
});

describe("shouldAutoCompleteUnit", () => {
  const base = {
    unitCount: 10,
    quantityComplete: 2,
    unitIndex: 2,
    allStepsRecorded: true,
    navigatesByEntity: false,
    entity: null,
    operationId: "op1"
  };

  it("completes the unit being built once every step is recorded", () => {
    expect(shouldAutoCompleteUnit(base)).toBe(true);
  });

  it("waits while a step is missing", () => {
    expect(shouldAutoCompleteUnit({ ...base, allStepsRecorded: false })).toBe(
      false
    );
  });

  it("never completes a single-quantity operation by itself", () => {
    // Those keep the manual Complete flow.
    expect(
      shouldAutoCompleteUnit({
        ...base,
        unitCount: 1,
        quantityComplete: 0,
        unitIndex: 0
      })
    ).toBe(false);
  });

  it("never re-completes a unit that is already built", () => {
    // Paging back to a finished unit: its records still read done.
    expect(shouldAutoCompleteUnit({ ...base, unitIndex: 1 })).toBe(false);
  });

  it("stops once the whole quantity is built", () => {
    expect(
      shouldAutoCompleteUnit({ ...base, quantityComplete: 10, unitIndex: 9 })
    ).toBe(false);
  });

  it("judges a serial unit by its own marker, not its position", () => {
    // Serial units may be worked in any order.
    const serial = { ...base, navigatesByEntity: true, unitIndex: 0 };
    expect(
      shouldAutoCompleteUnit({
        ...serial,
        entity: { id: "a", status: "Available" }
      })
    ).toBe(true);
    expect(
      shouldAutoCompleteUnit({
        ...serial,
        entity: { id: "a", attributes: { "Operation op1": true } }
      })
    ).toBe(false);
  });
});

describe("an operation with no steps", () => {
  // The real case on the test board: nineteen parts, one tool, no steps.
  it("shows what was really issued, because nothing will ever backflush", () => {
    const states = materialStates({
      materials: [part({ id: "bar", quantity: 1, quantityIssued: 1 })],
      steps: [],
      stepIndex: 0,
      unitIndex: 0,
      parentIsTracked: true
    });
    // Web reads 0 here for ever: its override waits on a first step that
    // does not exist. An operator who just issued the part must see it.
    expect(states[0]).toMatchObject({ issued: 1, fullyIssued: true });
  });

  it("still gives each unit only its own share", () => {
    const at = (unitIndex: number) =>
      materialStates({
        materials: [part({ quantity: 2, quantityIssued: 3 })],
        steps: [],
        stepIndex: 0,
        unitIndex,
        parentIsTracked: false
      })[0]?.issued;
    expect(at(0)).toBe(2);
    expect(at(1)).toBe(1);
    expect(at(2)).toBe(0);
  });
});

describe("isUnitBuilt", () => {
  it("counts by index for an untracked or batch parent", () => {
    const base = {
      navigatesByEntity: false,
      entity: null,
      quantityComplete: 2,
      operationId: "op1"
    };
    expect(isUnitBuilt({ ...base, unitIndex: 1 })).toBe(true);
    expect(isUnitBuilt({ ...base, unitIndex: 2 })).toBe(false);
  });

  it("asks the serial itself", () => {
    const base = {
      navigatesByEntity: true,
      unitIndex: 0,
      // Deliberately misleading: a serial ignores the completed count.
      quantityComplete: 5,
      operationId: "op1"
    };
    expect(isUnitBuilt({ ...base, entity: { id: "a" } })).toBe(false);
    expect(
      isUnitBuilt({
        ...base,
        entity: { id: "a", attributes: { "Operation op1": true } }
      })
    ).toBe(true);
  });
});

describe("maxNavigableUnitIndex", () => {
  it("stops a serial parent at the last unit that has a serial", () => {
    // Ten to build, one serial minted: the real state of the test job.
    expect(maxNavigableUnitIndex(deriveUnits(10, [{ id: "a" }]), true)).toBe(0);
    expect(
      maxNavigableUnitIndex(deriveUnits(10, [{ id: "a" }, { id: "b" }]), true)
    ).toBe(1);
  });

  it("lets every other parent reach every unit", () => {
    expect(maxNavigableUnitIndex(deriveUnits(10, [{ id: "lot" }]), false)).toBe(
      9
    );
    expect(maxNavigableUnitIndex(deriveUnits(1, []), false)).toBe(0);
  });
});

describe("nextIncompleteUnit", () => {
  it("is the first serial not yet built here", () => {
    const units = deriveUnits(3, [
      { id: "a", attributes: { "Operation op1": true } },
      { id: "b", status: "Scrapped" },
      { id: "c", status: "Available" }
    ]);
    expect(nextIncompleteUnit(units, "op1")?.entity?.id).toBe("c");
  });

  it("is null when every minted serial is built", () => {
    const units = deriveUnits(3, [
      { id: "a", attributes: { "Operation op1": true } }
    ]);
    expect(nextIncompleteUnit(units, "op1")).toBeNull();
  });
});

describe("containmentWithoutStep", () => {
  it("lists the open actions no step covers yet", () => {
    const actions = [{ id: "act_1" }, { id: "act_2" }];
    expect(
      containmentWithoutStep(actions, [
        { type: "Inspection", nonConformanceActionId: "act_1" }
      ])
    ).toEqual([{ id: "act_2" }]);
  });

  it("only counts an Inspection step as cover", () => {
    // Web's own rule: the marker on any other step type does not count.
    expect(
      containmentWithoutStep(
        [{ id: "act_1" }],
        [{ type: "Task", nonConformanceActionId: "act_1" }]
      )
    ).toEqual([{ id: "act_1" }]);
  });
});

describe("unissuedTrackedParts", () => {
  it("looks across every step, not just the one on screen", () => {
    const materials = [
      part({
        id: "battery",
        requiresSerialTracking: true,
        jobOperationStepIds: ["s9"]
      }),
      part({ id: "loose" }),
      part({
        id: "motor",
        requiresSerialTracking: true,
        quantityIssued: 1
      })
    ];
    expect(
      unissuedTrackedParts({
        materials,
        unitIndex: 0,
        parentIsTracked: true
      }).map((m) => m.id)
    ).toEqual(["battery"]);
  });

  it("derives a unit's share under an untracked parent", () => {
    const tire = part({
      id: "tire",
      quantity: 2,
      quantityIssued: 2,
      requiresBatchTracking: true
    });
    const at = (unitIndex: number) =>
      unissuedTrackedParts({
        materials: [tire],
        unitIndex,
        parentIsTracked: false
      }).length;
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
  });
});

describe("unitRemainingToIssue", () => {
  it("offers what this unit still needs, never the job's remainder", () => {
    expect(unitRemainingToIssue({ required: 2, issued: 0 })).toBe(2);
    expect(unitRemainingToIssue({ required: 2, issued: 1 })).toBe(1);
  });

  it("offers one when the unit needs nothing more", () => {
    expect(unitRemainingToIssue({ required: 2, issued: 2 })).toBe(1);
    expect(unitRemainingToIssue({ required: 0, issued: 3 })).toBe(1);
  });
});

describe("completedUnits", () => {
  it("is a whole, non-negative count", () => {
    expect(completedUnits(3)).toBe(3);
    expect(completedUnits(2.5)).toBe(3);
    expect(completedUnits(null)).toBe(0);
    expect(completedUnits(-1)).toBe(0);
    expect(completedUnits(Number.NaN)).toBe(0);
  });
});

describe("parseMeasurement", () => {
  it("takes zero and negatives, which a quantity would refuse", () => {
    expect(parseMeasurement("0")).toBe(0);
    expect(parseMeasurement("-0.25")).toBe(-0.25);
    expect(parseMeasurement(" 12.5 ")).toBe(12.5);
    expect(parseMeasurement(".5")).toBe(0.5);
    expect(parseMeasurement("7.")).toBe(7);
  });

  it("refuses anything that is not plainly a number", () => {
    for (const text of ["", " ", "-", ".", "1e3", "0x10", "1,5", "12mm"]) {
      expect(parseMeasurement(text)).toBeNull();
    }
  });
});

describe("stepChipState", () => {
  it("reads bad before done", () => {
    const failed = step("s", { type: "Inspection" }, [
      { index: 0, booleanValue: false }
    ]);
    expect(stepChipState(failed, 0)).toBe("bad");
    expect(stepChipState(step("t", {}, [{ index: 0 }]), 0)).toBe("done");
    expect(stepChipState(step("u"), 0)).toBe("todo");
  });
});
