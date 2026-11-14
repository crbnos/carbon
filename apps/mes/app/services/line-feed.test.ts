// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildLineFeedRows,
  type LineFeedRequestInput,
  type LineFeedTransferInput
} from "./line-feed";

const request = (id: string, createdAt: string): LineFeedRequestInput => ({
  id,
  workCenterId: "wc_1",
  itemId: "item_1",
  createdAt,
  note: null
});

const shortage = (itemId: string, short: number) => ({
  workCenterId: "wc_1",
  storageUnitId: "su_1",
  itemId,
  required: short + 1,
  onHand: 1,
  short
});

const transfer = (id: string, createdAt: string): LineFeedTransferInput => ({
  id,
  itemId: "item_1",
  outstandingQuantity: 4,
  createdAt,
  stockTransfer: { id: "st_1" },
  toStorageUnit: { workCenterId: "wc_1" }
});

describe("buildLineFeedRows", () => {
  it("lists requests, then shortages, then transfer lines", () => {
    const rows = buildLineFeedRows({
      transfers: [transfer("stl_1", "2026-11-12T08:00:00Z")],
      shortages: [shortage("item_2", 3)],
      requests: [request("mr_1", "2026-11-12T09:00:00Z")]
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "request",
      "shortage",
      "transfer"
    ]);
    expect(rows[1]).toMatchObject({ quantity: 3, createdAt: null });
    expect(rows[2]).toMatchObject({ quantity: 4, stockTransferId: "st_1" });
  });

  it("sorts requests oldest first and shortages largest first", () => {
    const rows = buildLineFeedRows({
      requests: [
        request("mr_new", "2026-11-12T10:00:00Z"),
        request("mr_old", "2026-11-12T07:00:00Z")
      ],
      shortages: [shortage("item_small", 1), shortage("item_large", 5)],
      transfers: []
    });
    expect(rows.map((row) => row.materialRequestId ?? row.itemId)).toEqual([
      "mr_old",
      "mr_new",
      "item_large",
      "item_small"
    ]);
  });
});
