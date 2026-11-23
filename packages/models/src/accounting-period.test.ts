// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type Operation,
  type Protocol,
  periodModel,
  SHIPPED,
  type Status
} from "./accounting-period";
import { explore } from "./explore";

const BEFORE_985011DD = {
  lifecycleLock: false,
  reopenInTransaction: false,
  statusCompareAndSet: false
};
const BEFORE_STATUS_CHECK = { ...SHIPPED, statusCompareAndSet: false };

describe("accounting period lifecycle", () => {
  it("before 985011ddf6, a January reopen and a February close both pass", () => {
    const result = explore(
      periodModel(
        ["Closed", "Locked"],
        [
          ["close", 1],
          ["reopen", 0]
        ],
        BEFORE_985011DD
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "no period is Closed after one that is not"
    );
    expect(result.violation.state.periods.map((p) => p.status)).toEqual([
      "Open",
      "Closed"
    ]);
  });

  it("before the status check, an unlock that read Locked reopens a period a close just closed", () => {
    const result = explore(
      periodModel(
        ["Locked", "Open"],
        [
          ["unlock", 0],
          ["close", 0]
        ],
        BEFORE_STATUS_CHECK
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "only a Closed period has a balance snapshot",
      trace: [
        "Unlock(P1): read the period: must be Locked",
        "Close(P1): read the period: must be Locked",
        "Close(P1): count earlier periods not Closed: must be none",
        "Close(P1): take the company's period lifecycle lock",
        "Close(P1): lock the period FOR NO KEY UPDATE: must be Locked",
        "Close(P1): re-check earlier periods under the lock",
        "Close(P1): set Closed and write the balance snapshot",
        "Close(P1): commit",
        "Unlock(P1): set Open"
      ]
    });
  });

  it("before the status check, a lock that read Open re-locks a period a close just closed", () => {
    const result = explore(
      periodModel(
        ["Open"],
        [
          ["lock", 0],
          ["lock", 0],
          ["close", 0]
        ],
        BEFORE_STATUS_CHECK
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.state).toMatchObject({
      periods: [{ status: "Locked", snapshot: true, closedAt: true }],
      illegalTransition: "P1 Closed -> Locked"
    });
  });

  it("the shipped protocol keeps every invariant for any three operations on three periods", () => {
    expect(everySmallRun(SHIPPED)).toEqual({ runs: 15 * 364, failures: [] });
  });

  it("the same search fails the protocol before the status check", () => {
    expect(everySmallRun(BEFORE_STATUS_CHECK).failures.length).toBeGreaterThan(
      0
    );
  });
});

/** Every start state that satisfies the invariants, with every multiset of three operations. */
function everySmallRun(protocol: Protocol) {
  const ops: [Operation, number][] = (
    ["lock", "unlock", "close", "reopen"] as const
  ).flatMap((op) => [0, 1, 2].map((i): [Operation, number] => [op, i]));

  const starts: Status[][] = [];
  for (let closed = 0; closed <= 3; closed++) {
    const rest = 3 - closed;
    for (let mask = 0; mask < 1 << rest; mask++) {
      starts.push([
        ...Array<Status>(closed).fill("Closed"),
        ...Array.from(
          { length: rest },
          (_, j): Status => (mask & (1 << j) ? "Locked" : "Open")
        )
      ]);
    }
  }

  const failures: string[] = [];
  let runs = 0;
  for (const start of starts) {
    for (let a = 0; a < ops.length; a++) {
      for (let b = a; b < ops.length; b++) {
        for (let c = b; c < ops.length; c++) {
          const result = explore(
            periodModel(start, [ops[a]!, ops[b]!, ops[c]!], protocol)
          );
          runs++;
          if (!result.ok) {
            failures.push(
              `${start.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
            );
          }
        }
      }
    }
  }
  return { runs, failures };
}
