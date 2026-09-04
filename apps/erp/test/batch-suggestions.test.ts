import { resolveBatchRules } from "@carbon/utils";
import { describe, expect, it } from "vitest";
// Import the logic module directly — the ERP barrels drag lingui macros vitest
// does not transform (see batching-migration-guards.test.ts).
import {
  candidateValueSets,
  computeGuideMismatches,
  computeLockedById,
  computeSelectionDimSets,
  groupingKey,
  materialSignature,
  rankSuggestions
} from "../app/modules/production/ui/Batches/batch-builder-logic";
import type {
  BatchCandidate,
  BatchMaterial
} from "../app/modules/production/types";

const DEFAULT_RULES = resolveBatchRules(null);

function makeMaterial(overrides: Partial<BatchMaterial> = {}): BatchMaterial {
  return {
    itemReadableId: null,
    description: null,
    quantity: null,
    formId: null,
    formName: null,
    substanceId: null,
    substanceName: null,
    gradeId: null,
    gradeName: null,
    dimensionId: null,
    dimensionName: null,
    finishId: null,
    finishName: null,
    ...overrides
  };
}

function makeCandidate(
  id: string,
  overrides: Partial<BatchCandidate> = {}
): BatchCandidate {
  return {
    id,
    jobId: `job-${id}`,
    jobReadableId: `J-${id}`,
    jobDueDate: null,
    jobStatus: "Ready",
    itemReadableId: "SAT-1000",
    itemDescription: null,
    description: null,
    operationQuantity: 1,
    status: "Todo",
    workCenterId: null,
    jobOperationBatchId: null,
    batchReadableId: null,
    batchStatus: null,
    batchWorkCenterId: null,
    materials: [],
    setupTime: 0,
    setupUnit: null,
    laborTime: null,
    laborUnit: null,
    machineTime: null,
    machineUnit: null,
    dueDate: null,
    thumbnailPath: null,
    ...overrides
  };
}

// Fixed "today": days until a due date, anchored so tests are deterministic.
const ANCHOR = new Date("2026-09-01T00:00:00Z").getTime();
const daysUntil = (due: string) =>
  Math.round((new Date(`${due}T00:00:00Z`).getTime() - ANCHOR) / 86_400_000);

const groupsOf = (...groups: [string, BatchCandidate[]][]) =>
  new Map(groups);

describe("materialSignature vs groupingKey", () => {
  it("materialSignature is EMPTY for an op with no BOM materials", () => {
    const c = makeCandidate("a", { itemReadableId: "SAT-1000" });
    expect(materialSignature(c, DEFAULT_RULES)).toBe("");
  });

  it("groupingKey falls back to the produced item for material-less ops", () => {
    const c = makeCandidate("a", { itemReadableId: "SAT-1000" });
    expect(groupingKey(c, DEFAULT_RULES)).toBe("SAT-1000");
  });

  it("two material-less ops with different items never share a material signature", () => {
    // The regression: the item fallback must not leak into the mixed-material
    // warning — both signatures are empty, so no "Mixing materials".
    const a = makeCandidate("a", { itemReadableId: "SAT-1000" });
    const b = makeCandidate("b", { itemReadableId: "SAT-2000" });
    expect(materialSignature(a)).toBe("");
    expect(materialSignature(b)).toBe("");
    expect(groupingKey(a)).not.toBe(groupingKey(b));
  });

  it("ops with real materials group by properties, not by item", () => {
    const steel = makeMaterial({ substanceName: "Steel", gradeName: "304" });
    const a = makeCandidate("a", { itemReadableId: "P-1", materials: [steel] });
    const b = makeCandidate("b", { itemReadableId: "P-2", materials: [steel] });
    expect(materialSignature(a)).toBe("Steel · 304");
    expect(groupingKey(a)).toBe(groupingKey(b));
  });
});

describe("rankSuggestions", () => {
  it("drops groups smaller than 2", () => {
    const out = rankSuggestions(
      groupsOf(["solo", [makeCandidate("a")]]),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out).toEqual([]);
  });

  it("never suggests a group that violates a must rule", () => {
    const rules = resolveBatchRules({ substance: "must" });
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const out = rankSuggestions(
      groupsOf(["mixed", [steel, alu]]),
      rules,
      null,
      daysUntil
    );
    expect(out).toEqual([]);
  });

  it("ranks a small urgent group above a big non-urgent one", () => {
    const urgent = [
      makeCandidate("u1", { dueDate: "2026-09-01" }),
      makeCandidate("u2", { dueDate: "2026-09-02" })
    ];
    const big = [
      makeCandidate("b1", { dueDate: "2026-11-01" }),
      makeCandidate("b2", { dueDate: "2026-11-01" }),
      makeCandidate("b3", { dueDate: "2026-11-01" }),
      makeCandidate("b4", { dueDate: "2026-11-01" })
    ];
    const out = rankSuggestions(
      groupsOf(["big", big], ["urgent", urgent]),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out.map((s) => s.sig)).toEqual(["urgent", "big"]);
    expect(out[0].reason).toBe("urgent");
  });

  it("prefers a group that fills a run over one that blows past capacity", () => {
    const fits = [
      makeCandidate("f1", { operationQuantity: 50 }),
      makeCandidate("f2", { operationQuantity: 50 })
    ];
    const over = [
      makeCandidate("o1", { operationQuantity: 150 }),
      makeCandidate("o2", { operationQuantity: 150 })
    ];
    const out = rankSuggestions(
      groupsOf(["over", over], ["fits", fits]),
      DEFAULT_RULES,
      100,
      daysUntil
    );
    expect(out.map((s) => s.sig)).toEqual(["fits", "over"]);
    expect(out[0].reason).toBe("fills");
    expect(out[0].fillRatio).toBe(1);
  });

  it("reports fillRatio as null with no capacity model", () => {
    const out = rankSuggestions(
      groupsOf(["g", [makeCandidate("a"), makeCandidate("b")]]),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out[0].fillRatio).toBeNull();
    expect(out[0].reason).toBe("group");
  });

  it("labels a setup-saving group 'setup' when nothing is urgent or filling", () => {
    const savers = [
      makeCandidate("s1", { setupTime: 30, setupUnit: "Minutes/Piece" }),
      makeCandidate("s2", { setupTime: 30, setupUnit: "Minutes/Piece" })
    ];
    const out = rankSuggestions(
      groupsOf(["savers", savers]),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out).toHaveLength(1);
    expect(out[0].saving).toBeGreaterThan(0);
    expect(out[0].reason).toBe("setup");
  });

  it("specificity: more matched dimensions outrank fewer, and a ' · ' inside a name does not inflate it", () => {
    // One dimension matched — but the substance NAME contains " · ", which the
    // old string-split counted as three tokens.
    const trickyName = [
      makeCandidate("t1", {
        materials: [makeMaterial({ substanceName: "A · B · C" })]
      }),
      makeCandidate("t2", {
        materials: [makeMaterial({ substanceName: "A · B · C" })]
      })
    ];
    // Two dimensions genuinely matched.
    const twoDims = [
      makeCandidate("d1", {
        materials: [makeMaterial({ substanceName: "Steel", gradeName: "304" })]
      }),
      makeCandidate("d2", {
        materials: [makeMaterial({ substanceName: "Steel", gradeName: "304" })]
      })
    ];
    const out = rankSuggestions(
      groupsOf(["tricky", trickyName], ["twoDims", twoDims]),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out.map((s) => s.sig)).toEqual(["twoDims", "tricky"]);
  });

  it("caps the result at 6 groups", () => {
    const entries: [string, BatchCandidate[]][] = Array.from(
      { length: 9 },
      (_, i) => [
        `g${i}`,
        [makeCandidate(`${i}a`), makeCandidate(`${i}b`)]
      ]
    );
    const out = rankSuggestions(
      groupsOf(...entries),
      DEFAULT_RULES,
      null,
      daysUntil
    );
    expect(out).toHaveLength(6);
  });
});

// The client mirror of the edge fn's assertMaterialCompatible: a candidate whose
// "must" dimension can't share a value with the current selection is LOCKED
// (visible-but-uncheckable). A test that fails if the must-gating is reverted.
describe("computeLockedById (must-violation gating)", () => {
  const rules = resolveBatchRules({ substance: "must" });

  it("locks a candidate whose must value can't join the selection", () => {
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const locked = computeLockedById(
      [steel, alu],
      new Set(["a"]),
      [candidateValueSets(steel)],
      rules
    );
    expect(locked.has("b")).toBe(true);
    expect(locked.get("b")).toContain("substance");
  });

  it("does not lock a candidate that shares the must value", () => {
    const s1 = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const s2 = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const locked = computeLockedById(
      [s1, s2],
      new Set(["a"]),
      [candidateValueSets(s1)],
      rules
    );
    expect(locked.has("b")).toBe(false);
  });

  it("locks nothing when the selection is empty", () => {
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const locked = computeLockedById([steel, alu], new Set(), [], rules);
    expect(locked.size).toBe(0);
  });

  it("never locks an already-selected candidate", () => {
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const locked = computeLockedById(
      [steel, alu],
      new Set(["a", "b"]),
      [candidateValueSets(steel), candidateValueSets(alu)],
      rules
    );
    expect(locked.has("b")).toBe(false);
  });

  it("does not lock on a dimension that is only a guide", () => {
    // Default rules make substance a GUIDE, not a must — differing substances
    // are advisory, never locked.
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const locked = computeLockedById(
      [steel, alu],
      new Set(["a"]),
      [candidateValueSets(steel)],
      DEFAULT_RULES
    );
    expect(locked.size).toBe(0);
  });
});

// Advisory GUIDE mismatch: a guide dimension where the selection has a value the
// candidate can't match. Warned (amber tag), never blocked.
describe("computeGuideMismatches (advisory guide mismatch)", () => {
  // Default rules put substance/grade/dimension on "guide".
  const rules = DEFAULT_RULES;

  it("flags a candidate whose guide value differs from the selection", () => {
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const alu = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Aluminum" })]
    });
    const sets = [candidateValueSets(steel)];
    const dimSets = computeSelectionDimSets(sets);
    const mismatches = computeGuideMismatches(
      [steel, alu],
      new Set(["a"]),
      sets,
      dimSets,
      rules
    );
    expect(mismatches.get("b")).toContain("substance");
  });

  it("does not flag a candidate matching the selection's guide value", () => {
    const s1 = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const s2 = makeCandidate("b", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const sets = [candidateValueSets(s1)];
    const dimSets = computeSelectionDimSets(sets);
    const mismatches = computeGuideMismatches(
      [s1, s2],
      new Set(["a"]),
      sets,
      dimSets,
      rules
    );
    expect(mismatches.has("b")).toBe(false);
  });

  it("flags nothing when the selection is empty", () => {
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const mismatches = computeGuideMismatches(
      [steel],
      new Set(),
      [],
      computeSelectionDimSets([]),
      rules
    );
    expect(mismatches.size).toBe(0);
  });

  it("does not flag a dimension the candidate carries no value for", () => {
    // The selection pins a substance, but the candidate has none — no basis to
    // warn, so it must not be flagged.
    const steel = makeCandidate("a", {
      materials: [makeMaterial({ substanceName: "Steel" })]
    });
    const bare = makeCandidate("b", {
      materials: [makeMaterial({ gradeName: "304" })]
    });
    const sets = [candidateValueSets(steel)];
    const dimSets = computeSelectionDimSets(sets);
    const mismatches = computeGuideMismatches(
      [steel, bare],
      new Set(["a"]),
      sets,
      dimSets,
      rules
    );
    expect(mismatches.has("b")).toBe(false);
  });
});
