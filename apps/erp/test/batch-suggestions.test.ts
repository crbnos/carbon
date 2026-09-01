import { resolveBatchRules } from "@carbon/utils";
import { describe, expect, it } from "vitest";
// Import the logic module directly — the ERP barrels drag lingui macros vitest
// does not transform (see batching-migration-guards.test.ts).
import {
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
