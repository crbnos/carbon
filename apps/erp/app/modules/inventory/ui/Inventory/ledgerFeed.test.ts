// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ItemLedger } from "../../types";
import { collapseTransferPairs, withRunningBalance } from "./ledgerFeed";

const row = (
  entryNumber: number,
  quantity: number,
  trackedEntityStatus: string | null = null
) => ({ entryNumber, quantity, trackedEntityStatus });

const balances = (rows: ReturnType<typeof withRunningBalance>) =>
  rows.map((r) => [r.balanceBefore, r.balanceAfter]);

describe("withRunningBalance", () => {
  // newest → oldest, as the feed holds them: +50, −2, +60, −10 → on hand 98
  const rows = [row(4, -10), row(3, 60), row(2, -2), row(1, 50)];

  it("walks older rows down from an anchor on the newest", () => {
    expect(
      balances(withRunningBalance(rows, { entryNumber: 4, balanceAfter: 98 }))
    ).toEqual([
      [108, 98],
      [48, 108],
      [50, 48],
      [0, 50]
    ]);
  });

  it("walks newer rows up from an anchor in the middle", () => {
    // A highlight navigation anchors on an older entry; "Load newer" then
    // prepends rows above it.
    expect(
      balances(withRunningBalance(rows, { entryNumber: 2, balanceAfter: 48 }))
    ).toEqual([
      [108, 98],
      [48, 108],
      [50, 48],
      [0, 50]
    ]);
  });

  it("counts a Rejected tracked entity's row as no change", () => {
    const withRejected = [row(3, 5), row(2, 7, "Rejected"), row(1, 10)];
    expect(
      balances(
        withRunningBalance(withRejected, { entryNumber: 3, balanceAfter: 15 })
      )
    ).toEqual([
      [10, 15],
      [10, 10],
      [0, 10]
    ]);
  });

  it("does not leak float noise into the balance", () => {
    const fractional = [row(3, 0.1), row(2, 0.2), row(1, 0.3)];
    const [, , oldest] = withRunningBalance(fractional, {
      entryNumber: 3,
      balanceAfter: 0.6
    });
    expect(oldest.balanceBefore).toBe(0);
  });

  it("leaves rows unpriced without an anchor, or when it is not loaded", () => {
    expect(balances(withRunningBalance(rows, null))).toEqual(
      rows.map(() => [null, null])
    );
    expect(
      balances(withRunningBalance(rows, { entryNumber: 99, balanceAfter: 1 }))
    ).toEqual(rows.map(() => [null, null]));
  });
});

describe("collapseTransferPairs with a running balance", () => {
  const ledger = (
    entryNumber: number,
    quantity: number,
    overrides: Partial<ItemLedger> = {}
  ) =>
    ({
      id: `il${entryNumber}`,
      entryNumber,
      quantity,
      itemId: "item",
      documentId: "doc",
      documentType: null,
      trackedEntityId: null,
      trackedEntityStatus: null,
      createdAt: `2026-10-02T00:00:0${entryNumber}Z`,
      storageUnit: { name: `Bin ${entryNumber}` },
      ...overrides
    }) as unknown as ItemLedger;

  it("spans both halves of a bin-to-bin transfer, so it reads as no change", () => {
    const transfer = {
      documentType: "Direct Transfer",
      createdAt: "2026-10-02T00:00:00Z"
    } as Partial<ItemLedger>;
    const raw = [
      ledger(3, 4, transfer), // inbound to Bin 3
      ledger(2, -4, transfer), // outbound from Bin 2
      ledger(1, 10)
    ];

    const collapsed = collapseTransferPairs(
      withRunningBalance(raw, { entryNumber: 3, balanceAfter: 10 })
    );

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toMatchObject({
      quantity: 4,
      transferFromStorageUnitName: "Bin 2",
      balanceBefore: 10,
      balanceAfter: 10
    });
    expect(collapsed[1]).toMatchObject({ balanceBefore: 0, balanceAfter: 10 });
  });

  it("prices around a hidden Batch Split", () => {
    const split = { documentType: "Batch Split" } as Partial<ItemLedger>;
    const raw = [
      ledger(4, -3),
      ledger(3, 5, split),
      ledger(2, -5, split),
      ledger(1, 10)
    ];

    const collapsed = collapseTransferPairs(
      withRunningBalance(raw, { entryNumber: 4, balanceAfter: 7 })
    );

    expect(
      collapsed.map((r) => [r.entryNumber, r.balanceBefore, r.balanceAfter])
    ).toEqual([
      [4, 10, 7],
      [1, 0, 10]
    ]);
  });
});
