// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  documentPostingModel,
  type Operation,
  type Protocol,
  SHIPPED,
  SHIPPED_PURCHASE_INVOICE,
  type Status
} from "./document-posting";
import { explore } from "./explore";

/** This branch's fixes off: the code as it stood after 97dbe6d8c5. */
const BEFORE_LOCK_ON_POST = {
  receipt: {
    ...SHIPPED,
    lockOnPost: false,
    postingResetOnlyFromPending: false
  },
  shipment: {
    ...SHIPPED,
    lockOnPost: false,
    postingResetOnlyFromPending: false,
    lockOnVoid: false
  },
  purchaseInvoice: {
    ...SHIPPED,
    lockOnPost: false,
    postingResetOnlyFromPending: false,
    operationResetOnlyFromPending: false
  }
} satisfies Record<string, Protocol>;
const BEFORE_97DBE6D8 = {
  ...BEFORE_LOCK_ON_POST.receipt,
  postableOnly: false
};
const BEFORE_BBE8DFD6 = { ...BEFORE_97DBE6D8, guardedClaim: false };
const BEFORE_019F07FB = { ...BEFORE_BBE8DFD6, refuseVoided: false };

describe("document posting", () => {
  it("before 019f07fb9b, a post of a voided receipt posts it again", () => {
    const result = explore(
      documentPostingModel("Voided", ["post"], BEFORE_019F07FB)
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "a document is never Posted after Voided",
      state: { status: "Posted", posts: 2, voids: 1 }
    });
    expect(
      explore(documentPostingModel("Voided", ["post"], BEFORE_BBE8DFD6)).ok
    ).toBe(true);
  });

  it("before bbe8dfd6a9, a post that read the receipt before a void flips it back from Voided and posts it again", () => {
    // Only this invariant: the re-claim of a Posted receipt that 97dbe6d8c5
    // refused breaks the ledger invariant in fewer steps.
    const afterVoid = (protocol: Protocol) => {
      const model = documentPostingModel("Posted", ["post", "void"], protocol);
      const invariant = "a document is never Posted after Voided";
      return explore({
        ...model,
        invariants: { [invariant]: model.invariants[invariant]! }
      });
    };

    const result = afterVoid(BEFORE_BBE8DFD6);
    expect(afterVoid(BEFORE_97DBE6D8).ok).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.trace.slice(0, 7)).toEqual([
      "Post#1: read the document: refuse Posted or Voided",
      "Void#2: the operation reads the document: refuse unless Posted",
      "Void#2: the posting reads the document: refuse unless Posted",
      "Void#2: lock the document FOR UPDATE: refuse unless Posted",
      "Void#2: write the reversal",
      "Void#2: UPDATE status = Voided",
      "Void#2: commit"
    ]);
    expect(result.violation.trace[7]).toBe(
      "Post#1: claim: UPDATE status = Pending"
    );
  });

  it("before the posting locks the document, two posts both claim it Pending and both post it", () => {
    const result = explore(
      documentPostingModel(
        "Draft",
        ["post", "post"],
        BEFORE_LOCK_ON_POST.receipt
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "a document is posted at most once",
      state: { status: "Posted", posts: 2, ledger: 2 }
    });
  });

  it("before the failure handler resets only from Pending, the post the lock refused returns the posted document to Draft", () => {
    const result = explore(
      documentPostingModel("Draft", ["post", "post"], {
        ...SHIPPED,
        postingResetOnlyFromPending: false
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "its ledger nets to its posted state",
      state: { status: "Draft", ledger: 1, posts: 1 }
    });
    expect(result.violation.trace.at(-1)).toBe(
      "Post#2: the posting's failure handler: UPDATE status = Draft"
    );
  });

  it("before the shipment void locks the shipment, two voids both reverse it", () => {
    const result = explore(
      documentPostingModel(
        "Posted",
        ["void", "void"],
        BEFORE_LOCK_ON_POST.shipment
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "a document is never voided twice",
      state: { status: "Voided", voids: 2, ledger: -1 }
    });
  });

  it("before the purchase invoice resets only from Pending, a price update that fails after the post leaves a Draft invoice with its journal", () => {
    const result = explore(
      documentPostingModel(
        "Draft",
        ["postLateFailure"],
        BEFORE_LOCK_ON_POST.purchaseInvoice
      )
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation).toMatchObject({
      invariant: "its ledger nets to its posted state",
      state: { status: "Draft", ledger: 1 }
    });
    expect(result.violation.trace.at(-1)).toBe(
      "LateFailingPost#1: the request fails after the commit: return the document to Draft"
    );
  });

  for (const [document, protocol] of [
    ["receipt and shipment", SHIPPED],
    ["purchase invoice", SHIPPED_PURCHASE_INVOICE]
  ] as const) {
    it(`the shipped ${document} protocol keeps every invariant from every start for any three posts, retries and voids`, () => {
      expect(everyRun(protocol)).toEqual({ runs: 220, failures: [] });
    });
  }

  for (const [document, protocol] of Object.entries(BEFORE_LOCK_ON_POST)) {
    it(`the same search fails the ${document} protocol before this branch's locks`, () => {
      expect(everyRun(protocol).failures.length).toBeGreaterThan(0);
    });
  }
});

const STARTS: Status[] = ["Draft", "Pending", "Posted", "Voided"];
const OPERATIONS: Operation[] = [
  "post",
  "retry",
  "void",
  "postFails",
  "postLateFailure"
];

/** Every start × every multiset of one to three operations: the actors are symmetric. */
function everyRun(protocol: Protocol) {
  const multisets: Operation[][] = [];
  const grow = (prefix: Operation[], from: number) => {
    if (prefix.length > 0) multisets.push(prefix);
    if (prefix.length === 3) return;
    for (let i = from; i < OPERATIONS.length; i++) {
      grow([...prefix, OPERATIONS[i]!], i);
    }
  };
  grow([], 0);

  const failures: string[] = [];
  for (const start of STARTS) {
    for (const operations of multisets) {
      const result = explore(documentPostingModel(start, operations, protocol));
      if (!result.ok) {
        failures.push(
          `${start} ${operations.join(",")}: ${result.violation.invariant}\n  ${result.violation.trace.join("\n  ")}`
        );
      }
    }
  }
  return { runs: STARTS.length * multisets.length, failures };
}
