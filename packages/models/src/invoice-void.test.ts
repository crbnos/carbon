// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import {
  invoiceVoidModel,
  type Operation,
  type Protocol,
  SHIPPED_PURCHASE,
  SHIPPED_SALES
} from "./invoice-void";

const BEFORE_UNDER_LOCK = {
  sales: { ...SHIPPED_SALES, refuseVoidedUnderLock: false },
  purchase: { ...SHIPPED_PURCHASE, refuseVoidedUnderLock: false }
};

describe("invoice void", () => {
  it("before 6797ddd57f, a void that read the journal first leaves a concurrent line account change on the voided invoice", () => {
    const result = explore(
      invoiceVoidModel(["void", "change"], {
        ...BEFORE_UNDER_LOCK.sales,
        lockBeforeJournalRead: false
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "a voided invoice nets to zero on every account"
    );
    expect(result.violation.trace).toEqual([
      "Void#1: read the invoice's journal lines",
      "Change#2: lock the invoice FOR UPDATE: refuse Voided",
      "Change#2: insert the change journal",
      "Change#2: commit",
      "Void#1: lock the invoice FOR UPDATE",
      "Void#1: insert the reversal and set Voided",
      "Void#1: commit"
    ]);
  });

  it("before the status check under the lock, a second sales void reverses the invoice again", () => {
    const result = explore(
      invoiceVoidModel(["void", "void"], BEFORE_UNDER_LOCK.sales)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.invariant).toBe(
      "an invoice is reversed at most once"
    );
  });

  it("before the status check under the lock, two purchase voids both pass the check made before the transaction", () => {
    const result = explore(
      invoiceVoidModel(["void", "void"], BEFORE_UNDER_LOCK.purchase)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "an invoice is reversed at most once",
      trace: [
        "Void#1: read the invoice: refuse Voided",
        "Void#1: lock the invoice FOR UPDATE",
        "Void#1: read the invoice's journal lines",
        "Void#1: insert the reversal and set Voided",
        "Void#2: read the invoice: refuse Voided",
        "Void#1: commit",
        "Void#2: lock the invoice FOR UPDATE",
        "Void#2: read the invoice's journal lines",
        "Void#2: insert the reversal and set Voided",
        "Void#2: commit"
      ]
    });
  });

  for (const [side, protocol] of [
    ["sales", SHIPPED_SALES],
    ["purchase", SHIPPED_PURCHASE]
  ] as const) {
    it(`the shipped ${side} void keeps every invariant against any four voids and line account changes`, () => {
      expect(everyRun(protocol)).toEqual({ runs: 30, failures: [] });
    });

    it(`the same search fails the ${side} void before the status check under the lock`, () => {
      expect(everyRun(BEFORE_UNDER_LOCK[side]).failures.length).toBeGreaterThan(
        0
      );
    });
  }
});

/** Every sequence of one to four operations, in every order. */
function everyRun(protocol: Protocol) {
  const sequences: Operation[][] = [];
  const grow = (prefix: Operation[]) => {
    if (prefix.length > 0) sequences.push(prefix);
    if (prefix.length === 4) return;
    for (const op of ["void", "change"] as const) grow([...prefix, op]);
  };
  grow([]);

  const failures: string[] = [];
  for (const actors of sequences) {
    const result = explore(invoiceVoidModel(actors, protocol));
    if (!result.ok) {
      failures.push(
        `${actors.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
      );
    }
  }
  return { runs: sequences.length, failures };
}
