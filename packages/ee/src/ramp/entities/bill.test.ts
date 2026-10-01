// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { buildBillMemo, RampBillSyncer } from "./bill";

/**
 * The memo is the only place a pushed bill NAMES the Carbon invoice and the
 * orders it settles, for a human reading it in Ramp. `invoice_number` belongs to
 * the SUPPLIER's reference (an AP clerk matches it against the paper).
 *
 * The bug: a bill in Ramp read only `CEX-Q-4471`, with nothing tying it to
 * `AP000008` or to the order it billed.
 *
 * Not a substitute for Ramp's own bill↔order link, which IS writable
 * (`purchase_order_ids`, plus the per-line `purchase_order_line_item_id`) and is
 * a follow-up — see `buildBillMemo`'s doc comment.
 */
describe("buildBillMemo", () => {
  it("names the Carbon invoice", () => {
    expect(buildBillMemo({ readableId: "AP000008" })).toBe("AP000008");
  });

  it("names the order the invoice bills", () => {
    expect(
      buildBillMemo({
        readableId: "AP000008",
        purchaseOrderReadableIds: ["PO000018"]
      })
    ).toBe("AP000008 · PO000018");
  });

  it("names every order on a consolidated invoice", () => {
    // One invoice against several orders is ordinary — the link lives on the
    // LINE, so naming only the first would misreport what the bill settles.
    expect(
      buildBillMemo({
        readableId: "AP000008",
        purchaseOrderReadableIds: ["PO000018", "PO000019"]
      })
    ).toBe("AP000008 · PO000018, PO000019");
  });

  it("stays a bare id when the invoice bills no order", () => {
    // A standalone payable (no PO) is common. A trailing separator there would
    // read as a missing value rather than an absent one.
    expect(
      buildBillMemo({ readableId: "AP000008", purchaseOrderReadableIds: [] })
    ).toBe("AP000008");
  });

  it("is searchable — bare ids, no prose around them", () => {
    // Somebody typing AP000008 or PO000018 into Ramp's search has to find this
    // bill; wrapping the ids in a sentence is what stops that working.
    const memo = buildBillMemo({
      readableId: "AP000008",
      purchaseOrderReadableIds: ["PO000018"]
    });

    expect(memo.split(" · ")).toEqual(["AP000008", "PO000018"]);
  });
});

/**
 * The bug: `shouldSync` did not look at the mapping, and the base class calls
 * `mapToRemote` BEFORE `upsertRemote`'s create-once guard. So an ordinary
 * `updatedAt` bump on a bill Ramp already held re-resolved (or re-created) the
 * Ramp spend vendor and replayed the posted journal, and could fail the whole
 * operation with `UNMAPPED_ACCOUNTS` for a bill that needed no work — a red row
 * in Sync Activity that no action clears.
 */
describe("RampBillSyncer.shouldSync — an already-handed-off bill", () => {
  const invoice = {
    id: "pinv_1",
    readableId: "AP000008",
    status: "Open",
    isEmployeeParty: false
  };

  // Only the mapping read is stubbed — it is the one thing a test process cannot
  // reach. `shouldSync` itself runs real, and the base class in
  // `accounting/core/types.ts` calls it BEFORE `mapToRemote`, so a skip here is
  // what keeps the vendor resolve and the journal replay from running at all.
  class ProbeBillSyncer extends RampBillSyncer {
    public mappedTo: string | null = null;

    public override async getRemoteId(): Promise<string | null> {
      return this.mappedTo;
    }

    public ask(entityId: string, localEntity: unknown) {
      return (
        this as unknown as {
          shouldSync(context: {
            entityId: string;
            localEntity?: unknown;
          }): Promise<boolean | string>;
        }
      ).shouldSync({ entityId, localEntity });
    }
  }

  const syncer = () =>
    new ProbeBillSyncer({
      database: {},
      companyId: "comp_1",
      provider: { id: "ramp" },
      config: { enabled: true },
      entityType: "bill"
    } as never);

  it("skips with a reason naming the draft, without touching Ramp", async () => {
    const probe = syncer();
    probe.mappedTo = "draft_abc";

    const outcome = await probe.ask("pinv_1", invoice);

    expect(typeof outcome).toBe("string");
    expect(outcome).toContain("draft_abc");
    expect(outcome).toContain("already handed off");
  });

  it("still proceeds for an unmapped bill", async () => {
    const probe = syncer();
    probe.mappedTo = null;

    expect(await probe.ask("pinv_1", invoice)).toBe(true);
  });

  it("keeps the earlier gates ahead of the mapping read", async () => {
    // A Paid or reimbursement invoice must report WHY it is ineligible, not
    // "already handed off" — those reasons are what a reader acts on.
    const probe = syncer();
    probe.mappedTo = "draft_abc";

    expect(await probe.ask("pinv_1", { ...invoice, status: "Paid" })).toContain(
      "Paid"
    );
    expect(
      await probe.ask("pinv_1", { ...invoice, isEmployeeParty: true })
    ).toContain("Employee");
  });
});
