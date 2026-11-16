// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildLineFeedRows,
  buildStationBoard,
  type LineFeedRequestInput,
  type LineFeedRow,
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

describe("buildStationBoard", () => {
  const row = (
    kind: LineFeedRow["kind"],
    workCenterId: string | null,
    itemId: string,
    quantity: number | null,
    onHand?: number
  ): LineFeedRow => ({
    kind,
    key: `${kind}:${workCenterId}:${itemId}`,
    workCenterId,
    storageUnitId: null,
    itemId,
    quantity,
    onHand,
    createdAt: null
  });

  const board = buildStationBoard({
    workCenters: [
      { id: "wc_wet", name: "Station 2" },
      { id: "wc_wet10", name: "Station 10" },
      { id: "wc_low", name: "Assembly" },
      { id: "wc_out", name: "Paint" },
      { id: "wc_asked", name: "Test" },
      { id: "wc_coming", name: "Weld" },
      { id: "wc_none", name: "Saw" }
    ],
    stationWorkCenterIds: [
      "wc_wet",
      "wc_wet10",
      "wc_low",
      "wc_out",
      "wc_asked",
      "wc_coming"
    ],
    workCenterNames: { wc_inactive: "Old cell" },
    rows: [
      row("request", "wc_asked", "item_1", null),
      row("request", null, "item_1", null),
      row("shortage", "wc_low", "item_1", 4, 2),
      row("shortage", "wc_out", "item_1", 6, 3),
      row("shortage", "wc_out", "item_2", 5, 0),
      row("shortage", "wc_coming", "item_1", 10, 0),
      row("shortage", "wc_coming", "item_2", 10, 0),
      row("shortage", "wc_inactive", "item_1", 1, 0),
      row("transfer", "wc_coming", "item_1", 10),
      row("transfer", "wc_coming", "item_2", 4)
    ]
  });
  const byId = Object.fromEntries(
    board.map((station) => [station.workCenterId ?? "none", station])
  );

  it("is out when a needed part has no stock, low when it has some", () => {
    expect(byId.wc_out.status).toBe("out");
    expect(byId.wc_low.status).toBe("low");
  });

  it("lists a station's parts out before its parts low", () => {
    expect(
      byId.wc_out.rows.map((line) => [line.itemId, line.stockStatus])
    ).toEqual([
      ["item_2", "out"],
      ["item_1", "low"]
    ]);
  });

  it("nets a shortage against the transfers on their way", () => {
    // item_1 is fully on its way; 6 of item_2 are still to bring.
    expect(
      byId.wc_coming.rows.map((line) => [line.kind, line.itemId, line.quantity])
    ).toEqual([
      ["shortage", "item_2", 6],
      ["transfer", "item_1", 10],
      ["transfer", "item_2", 4]
    ]);
    expect(byId.wc_coming.status).toBe("out");
  });

  it("is low, not out, when transfers cover every shortage", () => {
    const [station] = buildStationBoard({
      workCenters: [{ id: "wc_1", name: "Weld" }],
      stationWorkCenterIds: ["wc_1"],
      workCenterNames: {},
      rows: [
        row("shortage", "wc_1", "item_1", 10, 0),
        row("transfer", "wc_1", "item_1", 10)
      ]
    });
    expect(station.status).toBe("low");
    expect(station.rows.map((line) => line.kind)).toEqual(["transfer"]);
  });

  it("is low when an operator asked for material", () => {
    expect(byId.wc_asked.status).toBe("low");
  });

  it("is wet with no shortage, and unknown without lineside storage", () => {
    expect(byId.wc_wet.status).toBe("wet");
    expect(byId.wc_none.status).toBe("unknown");
  });

  it("ranks work for a work center off the board by its own status", () => {
    expect(byId.wc_inactive).toMatchObject({ name: "Old cell", status: "out" });
    expect(byId.none).toMatchObject({ name: null, status: "low" });
  });

  it("lists the stations that need stock first, numbers in order", () => {
    expect(board.map((station) => station.workCenterId)).toEqual([
      "wc_inactive",
      "wc_out",
      "wc_coming",
      "wc_low",
      "wc_asked",
      null,
      "wc_wet",
      "wc_wet10",
      "wc_none"
    ]);
  });
});
