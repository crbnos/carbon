// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import {
  type Operation,
  orderLineCountersModel,
  type Protocol,
  SHIPPED
} from "./order-line-counters";

const BEFORE_E179B0D8 = { ...SHIPPED, orderBeforeLine: false };
const BEFORE_9359B57E = {
  ...BEFORE_E179B0D8,
  lockLinesAsRead: false
};

describe("order line counters", () => {
  it("before 9359b57e9e, two posts on one line both write from the same read and the line counts one", () => {
    const result = explore(
      orderLineCountersModel(
        [
          { op: "post", document: "D2" },
          { op: "post", document: "D3" }
        ],
        BEFORE_9359B57E
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "the counter is the sum over the posted documents",
      state: {
        counter: 3,
        status: { D1: "Posted", D2: "Posted", D3: "Posted" }
      }
    });
  });

  it("before 9359b57e9e, a post that locks the order first and one that writes the line first deadlock", () => {
    const result = explore(
      orderLineCountersModel(
        [
          { op: "post", document: "D2", orderFirst: true },
          { op: "post", document: "D3" }
        ],
        BEFORE_9359B57E
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe("no deadlock");
  });

  it("before e179b0d865, a void that reads the line under its lock deadlocks against a post", () => {
    const result = explore(
      orderLineCountersModel(
        [
          { op: "post", document: "D2", orderFirst: true },
          { op: "void", document: "D1", underLock: true }
        ],
        BEFORE_E179B0D8
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "no deadlock",
      trace: [
        "Post D2: read the order line",
        "Post D2: lock the order FOR UPDATE",
        "Void D1: lock the line FOR UPDATE and read it",
        "Void D1: write the line: what it read less the document"
      ]
    });
  });

  it("the shipped protocol keeps both invariants and never deadlocks, for every mix of a void and two posts", () => {
    expect(everyRun(SHIPPED)).toEqual({ runs: 26, failures: [] });
  });

  it("the same search fails the protocol before e179b0d865", () => {
    expect(everyRun(BEFORE_E179B0D8).failures.length).toBeGreaterThan(0);
  });
});

function everyRun(protocol: Protocol) {
  const voids: (Operation | null)[] = [
    null,
    { op: "void", document: "D1" },
    { op: "void", document: "D1", underLock: true }
  ];
  const posts = (document: "D2" | "D3"): (Operation | null)[] => [
    null,
    { op: "post", document },
    { op: "post", document, orderFirst: true }
  ];
  const failures: string[] = [];
  let runs = 0;
  for (const first of voids) {
    for (const second of posts("D2")) {
      for (const third of posts("D3")) {
        const operations = [first, second, third].filter(
          (operation): operation is Operation => operation !== null
        );
        if (operations.length === 0) continue;
        runs++;
        const result = explore(orderLineCountersModel(operations, protocol));
        if (!result.ok) {
          failures.push(
            `${JSON.stringify(operations)}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
          );
        }
      }
    }
  }
  return { runs, failures };
}
