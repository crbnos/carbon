// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import {
  jobMaterialIssueModel,
  type Operation,
  type Protocol,
  type Settings,
  SHIPPED,
  STANDARD
} from "./job-material-issue";

const BEFORE_DRAW_LOCK_READ = { ...SHIPPED, readUnderDrawLock: false };
const BEFORE_5E8EA1F3 = {
  ...BEFORE_DRAW_LOCK_READ,
  issueByUnitsAccounted: false
};
const BEFORE_CA513209 = { ...BEFORE_5E8EA1F3, lockOperation: false };
const BEFORE_5A8961BA = { ...SHIPPED, backflushDrawLockInStrict: false };
const BEFORE_C85F0D23 = { ...SHIPPED, backflushLocksLayers: false };
const BEFORE_5B80420A = { ...SHIPPED, stepBackflushCapsAtTarget: false };

const STRICT: Settings = { strict: true, preventNegative: true, layers: false };
const STRICT_NEGATIVE: Settings = { ...STRICT, preventNegative: false };
const LAYERS: Settings = { ...STANDARD, layers: true };

describe("job material issue", () => {
  it("before ca513209d8, two completions at once issue the material twice and record it once", () => {
    const counts = (protocol: Protocol) => {
      const model = jobMaterialIssueModel(["complete", "complete"], protocol);
      const invariant = "quantityIssued counts every unit that left the bin";
      return explore({
        ...model,
        invariants: { [invariant]: model.invariants[invariant]! }
      });
    };

    const before = counts(BEFORE_CA513209);
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.violation.state).toMatchObject({
      ledger: 2,
      quantityIssued: 1
    });
    expect(counts(BEFORE_5E8EA1F3).ok).toBe(true);
  });

  it("before 5e8ea1f3d2, a completion after the unit's step issue issues its material again", () => {
    const result = explore(
      jobMaterialIssueModel(["stepIssue", "complete"], BEFORE_5E8EA1F3)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "an automatic issue never takes more than the unit still needs"
    );
  });

  it("before the read under the draw lock, a completion issues again what the job's backflush issued while it waited", () => {
    const result = explore(
      jobMaterialIssueModel(["complete", "backflush"], BEFORE_DRAW_LOCK_READ)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      trace: [
        "Complete#1: lock the operation FOR UPDATE",
        "Complete#1: read quantityIssued",
        "Backflush#2: lock the untracked draws",
        "Backflush#2: read quantityIssued",
        "Backflush#2: draw the target less what it read, add the draw to quantityIssued",
        "Backflush#2: commit",
        "Complete#1: lock the untracked draws",
        "Complete#1: draw the material, set quantityIssued to what it read plus the draw",
        "Complete#1: commit"
      ],
      state: { ledger: 2, quantityIssued: 1 }
    });
  });

  it("the shipped protocol keeps both invariants for every sequence of up to three issues", () => {
    expect(everyRun(SHIPPED)).toEqual({ runs: 39, failures: [] });
  });

  it("the same search fails the protocol before the read under the draw lock", () => {
    expect(everyRun(BEFORE_DRAW_LOCK_READ).failures.length).toBeGreaterThan(0);
  });

  it("before 5a8961ba33, under strict backflush a completion issues again what the job's backflush issued while it waited", () => {
    const result = explore(
      jobMaterialIssueModel(["complete", "backflush"], BEFORE_5A8961BA, STRICT)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      trace: [
        "Complete#1: lock the operation FOR UPDATE",
        "Complete#1: read quantityIssued",
        "Complete#1: lock the untracked draws, read quantityIssued again",
        "Backflush#2: lock the strict bins",
        "Backflush#2: read quantityIssued",
        "Backflush#2: draw the target less what it read, add the draw to quantityIssued",
        "Backflush#2: commit",
        "Complete#1: lockStrictBins",
        "Complete#1: draw the material, set quantityIssued to what it read plus the draw",
        "Complete#1: commit"
      ],
      state: { ledger: 2, quantityIssued: 1 }
    });
  });

  it("before 5a8961ba33, under strict backflush that may draw a bin negative, the job's backflush and a completion both issue the unit", () => {
    const result = explore(
      jobMaterialIssueModel(
        ["complete", "backflush"],
        BEFORE_5A8961BA,
        STRICT_NEGATIVE
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.state.ledger).toBe(2);
  });

  it("before 5a8961ba33, under strict backflush a step issue and the job's backflush wait on each other", () => {
    const result = explore(
      jobMaterialIssueModel(["stepIssue", "backflush"], BEFORE_5A8961BA, STRICT)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "no deadlock",
      state: { materialLock: "StepIssue#1", strictLock: "Backflush#2" }
    });
  });

  it("before c85f0d23cf, the job's backflush relieves a cost layer another consumer emptied", () => {
    const result = explore(
      jobMaterialIssueModel(["consume", "backflush"], BEFORE_C85F0D23, LAYERS)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "a cost layer's remaining quantity never goes below zero",
      state: { layer: -1, relieved: 2 }
    });
  });

  it("before 5b80420a22, a step backflush planned before a completion committed issues the unit's material again", () => {
    const result = explore(
      jobMaterialIssueModel(["stepBackflush", "complete"], BEFORE_5B80420A)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "an automatic issue never takes more than the unit still needs"
    );
  });

  it("the shipped protocol keeps every invariant for every setting and every three issues, step backflushes, backflushes and other consumers", () => {
    expect(everySetting(SHIPPED)).toEqual({ runs: 267, failures: [] });
  });

  it("the same search fails the protocol before each fix of strict backflush, cost layers and step backflush", () => {
    for (const protocol of [
      BEFORE_5A8961BA,
      BEFORE_C85F0D23,
      BEFORE_5B80420A
    ]) {
      expect(everySetting(protocol).failures.length).toBeGreaterThan(0);
    }
  });
});

function everyRun(protocol: Protocol) {
  const sequences: Operation[][] = [];
  const grow = (prefix: Operation[]) => {
    if (prefix.length > 0) sequences.push(prefix);
    if (prefix.length === 3) return;
    for (const op of ["complete", "stepIssue", "backflush"] as const) {
      grow([...prefix, op]);
    }
  };
  grow([]);

  const failures: string[] = [];
  for (const actors of sequences) {
    const result = explore(jobMaterialIssueModel(actors, protocol));
    if (!result.ok) {
      failures.push(
        `${actors.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
      );
    }
  }
  return { runs: sequences.length, failures };
}

/** Every multiset of up to three operations, under every setting. */
function everySetting(protocol: Protocol) {
  const settings: Settings[] = [];
  for (const layers of [false, true]) {
    settings.push({ strict: false, preventNegative: true, layers });
    settings.push({ strict: true, preventNegative: true, layers });
    settings.push({ strict: true, preventNegative: false, layers });
  }

  let runs = 0;
  const failures: string[] = [];
  for (const setting of settings) {
    const ops: Operation[] = [
      "complete",
      "stepIssue",
      "stepBackflush",
      "backflush",
      ...(setting.layers ? (["consume"] as const) : [])
    ];
    const multisets: Operation[][] = [];
    const grow = (prefix: Operation[], from: number) => {
      if (prefix.length > 0) multisets.push(prefix);
      if (prefix.length === 3) return;
      for (let i = from; i < ops.length; i++) grow([...prefix, ops[i]!], i);
    };
    grow([], 0);

    for (const actors of multisets) {
      runs++;
      const result = explore(jobMaterialIssueModel(actors, protocol, setting));
      if (!result.ok) {
        failures.push(
          `${JSON.stringify(setting)} ${actors.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
        );
      }
    }
  }
  return { runs, failures };
}
