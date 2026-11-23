// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import {
  jobMaterialIssueModel,
  type Operation,
  type Protocol,
  SHIPPED
} from "./job-material-issue";

const BEFORE_DRAW_LOCK_READ = { ...SHIPPED, readUnderDrawLock: false };
const BEFORE_5E8EA1F3 = {
  ...BEFORE_DRAW_LOCK_READ,
  issueByUnitsAccounted: false
};
const BEFORE_CA513209 = { ...BEFORE_5E8EA1F3, lockOperation: false };

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
