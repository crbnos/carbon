// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildLaneBoard,
  buildLineFeedRows,
  buildStationBoard,
  type LaneRowInput,
  type LineFeedRequestInput,
  type LineFeedRow,
  type LineFeedTransferInput,
  laneSeverity,
  laneVerdict,
  type StationCard,
  summarizeLanes
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

describe("laneVerdict", () => {
  const none = { deliver: 0, finish: 0, build: 0, rawShort: 0 };

  it("names the first kind of work the lane has", () => {
    expect(laneVerdict({ deliver: 1, finish: 1, build: 1, rawShort: 1 })).toBe(
      "deliver"
    );
    expect(laneVerdict({ ...none, finish: 1, build: 1, rawShort: 1 })).toBe(
      "finish"
    );
    expect(laneVerdict({ ...none, build: 2, rawShort: 1 })).toBe("build");
    expect(laneVerdict({ ...none, rawShort: 1 })).toBe("rawShort");
    expect(laneVerdict(none)).toBe("ok");
  });

  it("is red when the station is out, amber when low or not ok", () => {
    expect(laneSeverity("out", "deliver")).toBe("red");
    expect(laneSeverity("low", "ok")).toBe("amber");
    expect(laneSeverity("wet", "rawShort")).toBe("amber");
    expect(laneSeverity("wet", "ok")).toBe("green");
  });
});

describe("buildLaneBoard", () => {
  const station = (
    workCenterId: string,
    status: StationCard["status"] = "wet",
    rows: StationCard["rows"] = []
  ): StationCard => ({ workCenterId, name: workCenterId, status, rows });

  const a3 = (
    state: string,
    row: Omit<LaneRowInput, "workCenterId" | "tier" | "state"> = {}
  ): LaneRowInput => ({
    workCenterId: "A3",
    tier: state === "bin" ? "raw" : state === "atStation" ? "station" : "kit",
    state: state === "atStation" ? "kit" : state,
    ...row
  });

  // A combustor kit takes 2 igniters and 1 liner; the rack holds 3.
  const slot = (need: number) =>
    a3("slot", { itemId: "KIT", storageUnitId: "KIT-RACK-1", need, target: 3 });
  const kitAt = (state: "atStation" | "complete", serial: string) =>
    a3(state, { itemId: "KIT", trackedEntityId: serial, quantity: 1 });
  const incomplete = (jobId: string, missing: number) => [
    a3("incomplete", {
      itemId: "KIT",
      jobId,
      storageUnitId: "KIT-RACK-1",
      quantity: 1
    }),
    a3("missing", {
      itemId: "IGN",
      parentKitItemId: "KIT",
      jobId,
      quantity: missing
    })
  ];
  const shelf = (ign: number, lnr = 12) => [
    a3("bin", {
      itemId: "IGN",
      parentKitItemId: "KIT",
      storageUnitId: "WH1-B1",
      quantity: ign,
      need: 2
    }),
    a3("bin", {
      itemId: "LNR",
      parentKitItemId: "KIT",
      storageUnitId: "WH1-B2",
      quantity: lnr,
      need: 1
    })
  ];

  const lane = (laneRows: LaneRowInput[], card = station("A3")) =>
    buildLaneBoard({ stations: [card], laneRows })[0];

  it("worked example: a fed station with an empty igniter bin is raw short, in amber", () => {
    const shortage: LineFeedRow = {
      kind: "shortage",
      key: "shortage:A3:KIT",
      workCenterId: "A3",
      storageUnitId: "A3-LINE",
      itemId: "KIT",
      quantity: 2,
      onHand: 1,
      stockStatus: "low",
      createdAt: null
    };
    const example = lane(
      [
        slot(3),
        kitAt("atStation", "KIT-2"),
        kitAt("complete", "KIT-3"),
        ...incomplete("job_kit_1", 2),
        ...shelf(0)
      ],
      station("A3", "low", [shortage])
    );

    expect(example.verdict).toBe("rawShort");
    expect(example.shortItemIds).toEqual(["IGN"]);
    // The kit's shortage is the kit's line, not a loose part to bring.
    expect(example.looseRows).toEqual([]);
    expect(example.kits[0].stationStatus).toBe("ok");
    expect(example.raw.map((bin) => bin.kitItemIds)).toEqual([
      ["KIT"],
      ["KIT"]
    ]);
    expect(example.severity).toBe("amber");

    const [kit] = example.kits;
    expect(kit).toMatchObject({ demand: 3, covers: 1, target: 3 });
    expect(kit.atStation.map((unit) => unit.trackedEntityId)).toEqual([
      "KIT-2"
    ]);
    expect(kit.complete.map((unit) => unit.trackedEntityId)).toEqual(["KIT-3"]);
    expect(kit.incomplete).toEqual([
      {
        jobId: "job_kit_1",
        readableId: null,
        storageUnitId: "KIT-RACK-1",
        quantity: 1,
        missing: [{ itemId: "IGN", quantity: 2 }],
        covered: false
      }
    ]);
    // 2 for the incomplete kit, 2 for the kit the rack is below target by.
    expect(example.raw).toMatchObject([
      { itemId: "IGN", storageUnitId: "WH1-B1", status: "empty", need: 4 },
      { itemId: "LNR", status: "ok", need: 1 }
    ]);
  });

  it("deliver: the station is out and a complete kit is on the rack", () => {
    const out = lane(
      [
        slot(2),
        kitAt("complete", "KIT-3"),
        ...incomplete("job", 2),
        ...shelf(0)
      ],
      station("A3", "out")
    );
    expect(out.verdict).toBe("deliver");
    expect(out.severity).toBe("red");
    expect(out.work).toMatchObject({ deliver: 1, rawShort: 1 });
    expect(out.kits[0].stationStatus).toBe("bring");
  });

  it("does not ask for a kit that is already on its way", () => {
    const coming: LineFeedRow = {
      kind: "transfer",
      key: "transfer:1",
      workCenterId: "A3",
      storageUnitId: "A3-LINE",
      itemId: "KIT",
      quantity: 1,
      createdAt: null
    };
    const rows = [
      slot(2),
      kitAt("complete", "KIT-3"),
      kitAt("complete", "KIT-4"),
      kitAt("complete", "KIT-5")
    ];
    expect(lane(rows, station("A3", "low", [coming])).verdict).toBe("ok");
  });

  it("finish kit: the shelf covers what an incomplete kit is missing", () => {
    const finish = lane([
      slot(1),
      kitAt("atStation", "KIT-2"),
      kitAt("complete", "KIT-3"),
      kitAt("complete", "KIT-4"),
      ...incomplete("job", 2),
      ...shelf(2)
    ]);
    expect(finish.verdict).toBe("finish");
    expect(finish.work).toEqual({
      deliver: 0,
      finish: 1,
      build: 0,
      rawShort: 0
    });
    expect(finish.kits[0].incomplete[0].covered).toBe(true);
    expect(finish.severity).toBe("amber");
  });

  it("build kit: the rack is below target and the shelf covers one kit", () => {
    const build = lane([
      slot(1),
      kitAt("atStation", "KIT-2"),
      kitAt("complete", "KIT-3"),
      ...shelf(6)
    ]);
    expect(build.verdict).toBe("build");
    expect(build.work.build).toBe(2);
    expect(build.raw[0]).toMatchObject({ need: 4, status: "ok" });
  });

  it("raw short: the rack is below target and a bin cannot cover a kit", () => {
    const short = lane([
      slot(1),
      kitAt("atStation", "KIT-2"),
      kitAt("complete", "KIT-3"),
      ...shelf(1)
    ]);
    expect(short.verdict).toBe("rawShort");
    expect(short.raw[0]).toMatchObject({ need: 4, status: "short" });
  });

  it("ok: a full rack needs nothing, and a thin bin is only low", () => {
    const ok = lane([
      slot(1),
      kitAt("atStation", "KIT-2"),
      kitAt("complete", "KIT-3"),
      kitAt("complete", "KIT-4"),
      kitAt("complete", "KIT-5"),
      ...shelf(1)
    ]);
    expect(ok.verdict).toBe("ok");
    expect(ok.severity).toBe("green");
    expect(ok.raw[0]).toMatchObject({ need: 0, status: "low" });
  });

  it("fed directly: a station short of a part needs it from the kanban's source bin", () => {
    const shortage: LineFeedRow = {
      kind: "shortage",
      key: "shortage:A3:BOLT",
      workCenterId: "A3",
      storageUnitId: "A3-LINE",
      itemId: "BOLT",
      quantity: 8,
      onHand: 0,
      stockStatus: "out",
      createdAt: null
    };
    const direct = lane(
      [a3("bin", { itemId: "BOLT", storageUnitId: "WH1-B9", quantity: 5 })],
      station("A3", "out", [shortage])
    );
    expect(direct.kits).toEqual([]);
    expect(direct.looseRows).toEqual([shortage]);
    expect(direct.raw[0].kitItemIds).toEqual([]);
    expect(direct.raw).toMatchObject([{ need: 8, status: "short" }]);
    expect(direct.verdict).toBe("rawShort");
    expect(direct.severity).toBe("red");
  });

  it("runs lanes in line order, or worst first, and counts their work", () => {
    const stations = [
      station("C", "out"),
      station("B"),
      station("A"),
      station("Z")
    ];
    const laneRows: LaneRowInput[] = [
      { workCenterId: "A", tier: "station", state: "line", quantity: 3 },
      { workCenterId: "B", tier: "station", state: "line", quantity: 1 },
      { workCenterId: "C", tier: "station", state: "line", quantity: 2 }
    ];
    const names = (sort?: "worst") =>
      buildLaneBoard({ stations, laneRows, sort }).map((l) => l.name);
    expect(names()).toEqual(["B", "C", "A", "Z"]);
    expect(names("worst")).toEqual(["C", "B", "A", "Z"]);
    expect(summarizeLanes(buildLaneBoard({ stations, laneRows }))).toEqual({
      out: 1,
      deliver: 0,
      finish: 0,
      build: 0,
      rawShort: 0
    });
  });
});
