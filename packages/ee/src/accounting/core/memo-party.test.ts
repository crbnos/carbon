// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type MemoPartyLookup,
  type MemoPartyRow,
  memoPartyFromRow,
  resolveMemoPartyFromLookup
} from "./memo-party";

/**
 * A lookup over an in-memory world. `linesByJournalId` is the memo id a
 * journal's OWN lines carry (the original posting journal and its VOID both
 * have one); `memoByJournalId` is the `memo.journalId` pointer, which names
 * the original only.
 */
function makeLookup(world: {
  linesByJournalId?: Record<string, string>;
  memosById?: Record<string, MemoPartyRow>;
  memoByJournalId?: Record<string, MemoPartyRow>;
}): MemoPartyLookup {
  return {
    findMemoIdOnJournalLines: async (journalId) =>
      world.linesByJournalId?.[journalId] ?? null,
    findMemoById: async (memoId) => world.memosById?.[memoId] ?? null,
    findMemoByJournalId: async (journalId) =>
      world.memoByJournalId?.[journalId] ?? null
  };
}

const customerMemo: MemoPartyRow = { customerId: "cust-1", supplierId: null };
const supplierMemo: MemoPartyRow = { customerId: null, supplierId: "supp-1" };

describe("memoPartyFromRow", () => {
  it.each([
    [customerMemo, "customer"],
    [supplierMemo, "supplier"],
    [{ customerId: null, supplierId: null }, null],
    [null, null]
  ] as const)("reads the party off memo %o as %s", (row, party) => {
    expect(memoPartyFromRow(row)).toBe(party);
  });
});

describe("resolveMemoPartyFromLookup", () => {
  // Voiding a memo INSERTS A NEW journal and leaves `memo.journalId` on the
  // original, so a void resolves only through the journal LINES.
  it.each([
    [customerMemo, "customer"],
    [supplierMemo, "supplier"]
  ] as const)(
    "resolves a VOID memo journal through its lines (%o → %s)",
    async (memo, party) => {
      const lookup = makeLookup({
        linesByJournalId: { "journal-void": "memo-1" },
        memosById: { "memo-1": memo },
        memoByJournalId: { "journal-original": memo }
      });
      expect(await resolveMemoPartyFromLookup(lookup, "journal-void")).toBe(
        party
      );
    }
  );

  it("prefers the memo the lines name over the memo.journalId pointer", async () => {
    const lookup = makeLookup({
      linesByJournalId: { "journal-original": "memo-1" },
      memosById: { "memo-1": customerMemo },
      memoByJournalId: { "journal-original": supplierMemo }
    });
    expect(await resolveMemoPartyFromLookup(lookup, "journal-original")).toBe(
      "customer"
    );
  });

  it("falls back to memo.journalId when the journal's lines carry no memo", async () => {
    const lookup = makeLookup({
      memoByJournalId: { "journal-original": supplierMemo }
    });
    expect(await resolveMemoPartyFromLookup(lookup, "journal-original")).toBe(
      "supplier"
    );
  });

  it("answers null when neither path finds a memo", async () => {
    expect(
      await resolveMemoPartyFromLookup(makeLookup({}), "journal-x")
    ).toBeNull();
  });

  it("answers null when the lines name a memo with no party", async () => {
    const lookup = makeLookup({
      linesByJournalId: { "journal-void": "memo-3" },
      memosById: { "memo-3": { customerId: null, supplierId: null } }
    });
    expect(await resolveMemoPartyFromLookup(lookup, "journal-void")).toBeNull();
  });
});
