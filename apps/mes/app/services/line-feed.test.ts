// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildLineFeedRows,
  buildStationStatuses,
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

describe("buildStationStatuses", () => {
  const workCenters = [
    { id: "wc_wet", name: "Weld" },
    { id: "wc_low", name: "Assembly" },
    { id: "wc_out", name: "Paint" },
    { id: "wc_asked", name: "Test" },
    { id: "wc_none", name: "Saw" }
  ];
  const stations = buildStationStatuses({
    workCenters,
    stationWorkCenterIds: ["wc_wet", "wc_low", "wc_out", "wc_asked"],
    shortages: [
      { workCenterId: "wc_low", onHand: 2 },
      { workCenterId: "wc_out", onHand: 3 },
      { workCenterId: "wc_out", onHand: 0 }
    ],
    requests: [{ workCenterId: "wc_asked" }, { workCenterId: null }]
  });
  const byId = Object.fromEntries(
    stations.map((station) => [station.workCenterId, station])
  );

  it("is out when a needed part has no stock, low when it has some", () => {
    expect(byId.wc_out).toMatchObject({ status: "out", out: 1, low: 1 });
    expect(byId.wc_low).toMatchObject({ status: "low", out: 0, low: 1 });
  });

  it("is low when an operator asked for material", () => {
    expect(byId.wc_asked).toMatchObject({ status: "low", requests: 1 });
  });

  it("is wet with no shortage, and unknown without lineside storage", () => {
    expect(byId.wc_wet.status).toBe("wet");
    expect(byId.wc_none.status).toBe("unknown");
  });

  it("lists the stations that need stock first", () => {
    expect(stations.map((station) => station.workCenterId)).toEqual([
      "wc_out",
      "wc_low",
      "wc_asked",
      "wc_wet",
      "wc_none"
    ]);
  });
});
