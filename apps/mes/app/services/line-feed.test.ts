// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildFlow,
  buildLaneBoard,
  buildLineFeedRows,
  buildStationBoard,
  type LaneRowInput,
  type LineFeedRequestInput,
  type LineFeedRow,
  type LineFeedTransferInput,
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
    a3(state, {
      itemId: "KIT",
      trackedEntityId: serial,
      storageUnitId: state === "complete" ? "KIT-RACK-1" : "A3-LINE",
      quantity: 1
    });
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

  // A3 has an open operation.
  const lane = (laneRows: LaneRowInput[], card = station("A3")) =>
    buildLaneBoard({
      stations: [card],
      laneRows: [
        { workCenterId: "A3", tier: "station", state: "line", quantity: 1 },
        ...laneRows
      ]
    })[0];

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
    // A kit to bring is work for the water spider, not a missing part.
    expect(out.need).toBe("bring");
    expect(out.severity).toBe("amber");
    expect(out.work).toMatchObject({ deliver: 1, rawShort: 1 });
    expect(out.kits[0].stationStatus).toBe("bring");
    expect(out.kits[0].source).toMatchObject({
      trackedEntityId: "KIT-3",
      quantity: 1
    });
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

  it("raw short: an incomplete kit misses a part that is on no shelf", () => {
    const stuck = lane([
      slot(1),
      kitAt("atStation", "KIT-2"),
      kitAt("complete", "KIT-3"),
      kitAt("complete", "KIT-4"),
      a3("incomplete", { itemId: "KIT", jobId: "job", quantity: 1 }),
      a3("missing", {
        itemId: "GASKET",
        parentKitItemId: "KIT",
        jobId: "job",
        quantity: 1
      }),
      ...shelf(6)
    ]);
    expect(stuck.verdict).toBe("rawShort");
    expect(stuck.shortItemIds).toEqual(["GASKET"]);
    expect(stuck.kits[0].incomplete[0].covered).toBe(false);
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
    expect(build.kits[0].rackGap).toBe(2);
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
    // The kanban's source bin is also where to grab the part.
    expect(direct.looseRows).toEqual([
      {
        ...shortage,
        cover: "fed",
        source: { storageUnitId: "WH1-B9", onHand: 5, quantity: 5 }
      }
    ]);

    // With no kanban, the row says which shelf bin to grab it from.
    const grab = lane(
      [
        {
          workCenterId: "A3",
          tier: "raw",
          state: "source",
          itemId: "BOLT",
          storageUnitId: "WH1-B9",
          quantity: 5
        }
      ],
      station("A3", "out", [shortage])
    );
    expect(grab.looseRows[0].source).toEqual({
      storageUnitId: "WH1-B9",
      onHand: 5,
      quantity: 5
    });
    expect(grab.raw).toEqual([]);

    // The station's Transfer kanban names its source: that bin wins while it
    // holds stock.
    const kanban = lane(
      [
        a3("bin", { itemId: "BOLT", storageUnitId: "WH1-B9", quantity: 20 }),
        {
          workCenterId: "A3",
          tier: "raw",
          state: "source",
          itemId: "BOLT",
          storageUnitId: "WH1-A1",
          quantity: 5
        }
      ],
      station("A3", "out", [shortage])
    );
    expect(kanban.looseRows[0].source).toEqual({
      storageUnitId: "WH1-B9",
      onHand: 20,
      quantity: 8
    });
    expect(direct.raw[0].kitItemIds).toEqual([]);
    expect(direct.raw).toMatchObject([{ need: 8, status: "short" }]);
    expect(direct.verdict).toBe("rawShort");
    expect(direct.need).toBe("bring");
  });

  const shortOf = (
    workCenterId: string,
    itemId: string,
    quantity: number
  ): LineFeedRow => ({
    kind: "shortage",
    key: `shortage:${workCenterId}:${itemId}`,
    workCenterId,
    storageUnitId: `${workCenterId}-LINE`,
    itemId,
    quantity,
    onHand: 0,
    stockStatus: "out",
    createdAt: null
  });
  const sourceOf = (
    workCenterId: string,
    row: Omit<LaneRowInput, "workCenterId" | "tier" | "state">
  ): LaneRowInput => ({ workCenterId, tier: "raw", state: "source", ...row });

  it("stock in no bin is not a raw shortage; no stock at all is", () => {
    const unbinned = lane(
      [sourceOf("A3", { itemId: "BOLT", quantity: 40 })],
      station("A3", "out", [shortOf("A3", "BOLT", 8)])
    );
    expect(unbinned.looseRows[0].source).toBeUndefined();
    expect(unbinned.looseRows[0].supply).toEqual({
      unbinned: 40,
      replenishing: false
    });
    expect(unbinned.work.rawShort).toBe(0);

    const none = lane(
      [
        sourceOf("A3", {
          itemId: "BOLT",
          quantity: 0,
          replenishing: true
        })
      ],
      station("A3", "out", [shortOf("A3", "BOLT", 8)])
    );
    expect(none.looseRows[0].supply).toEqual({
      unbinned: 0,
      replenishing: true
    });
    expect(none.work.rawShort).toBe(1);
    expect(none.shortItemIds).toEqual(["BOLT"]);
    expect(none.verdict).toBe("rawShort");
  });

  it("an empty shelf bin names the part's stock in another bin", () => {
    const [empty] = lane([
      a3("bin", { itemId: "BOLT", storageUnitId: "WH1-B9", quantity: 0 }),
      sourceOf("A3", { itemId: "BOLT", storageUnitId: "WH1-G5", quantity: 90 })
    ]).raw;
    expect(empty).toMatchObject({
      status: "empty",
      elsewhere: { storageUnitId: "WH1-G5", onHand: 90 }
    });

    // The kit's igniter bin is empty, but another bin covers the two it needs.
    const covered = lane([
      slot(1),
      ...shelf(0),
      sourceOf("A3", { itemId: "IGN", storageUnitId: "WH1-G5", quantity: 90 })
    ]);
    expect(covered.work.rawShort).toBe(0);
  });

  it("gives a bin's stock and a rack kit to one station, in line order", () => {
    const stations = [
      station("B", "out", [shortOf("B", "BOLT", 4)]),
      station("A", "out", [shortOf("A", "BOLT", 4)])
    ];
    const kitRows = (workCenterId: string): LaneRowInput[] => [
      {
        workCenterId,
        tier: "kit",
        state: "slot",
        itemId: "KIT",
        storageUnitId: "KIT-RACK-1",
        need: 1
      },
      {
        workCenterId,
        tier: "kit",
        state: "complete",
        itemId: "KIT",
        trackedEntityId: "K-1",
        storageUnitId: "KIT-RACK-1",
        quantity: 1
      }
    ];
    const [first, second] = buildLaneBoard({
      stations,
      laneRows: [
        { workCenterId: "A", tier: "station", state: "line", quantity: 1 },
        { workCenterId: "B", tier: "station", state: "line", quantity: 2 },
        ...["A", "B"].flatMap((workCenterId) => [
          sourceOf(workCenterId, {
            itemId: "BOLT",
            storageUnitId: "WH1-B9",
            quantity: 6
          }),
          ...kitRows(workCenterId)
        ])
      ],
      // The board's order does not change who gets the stock.
      sort: "worst"
    });
    expect([first.name, second.name]).toEqual(["A", "B"]);
    expect(first.looseRows[0].source).toEqual({
      storageUnitId: "WH1-B9",
      onHand: 6,
      quantity: 4
    });
    expect(second.looseRows[0].source).toEqual({
      storageUnitId: "WH1-B9",
      onHand: 6,
      quantity: 2,
      claimed: 4
    });
    // One kit on the rack: the first station brings it, the second waits.
    expect(first.kits[0].stationStatus).toBe("bring");
    expect(first.kits[0].source?.trackedEntityId).toBe("K-1");
    expect(second.kits[0].stationStatus).toBe("out");
    expect(second.kits[0].source).toBeUndefined();
    expect([first.work.deliver, second.work.deliver]).toEqual([1, 0]);
  });

  it("a part in the warehouse is to bring; a part made here is waited on", () => {
    const need = (row: Omit<LaneRowInput, "workCenterId" | "tier" | "state">) =>
      lane(
        [
          sourceOf("A3", { itemId: "BOLT", ...row }),
          {
            workCenterId: "B1",
            tier: "flow",
            state: "step",
            itemId: "MADE",
            quantity: 10
          },
          sourceOf("A3", { itemId: "MADE", quantity: 0, need: 0 })
        ],
        station("A3", "out", [shortOf("A3", "BOLT", 8)])
      );
    // The warehouse holds 40: the 8 are to bring lineside, not missing.
    const covered = need({ storageUnitId: "WH1-B9", quantity: 40, need: 40 });
    expect(covered.looseRows[0].cover).toBe("site");
    expect([covered.need, covered.severity]).toEqual(["bring", "amber"]);
    expect(covered.toBring).toBe(1);

    // Lineside covers the open work: nothing is short.
    const ready = lane([]);
    expect([ready.need, ready.severity]).toEqual(["ready", "green"]);

    const short = need({ storageUnitId: "WH1-B9", quantity: 5, need: 5 });
    expect(short.looseRows[0].cover).toBe("none");
    expect([short.need, short.severity]).toEqual(["short", "red"]);

    const upstream = lane(
      [
        {
          workCenterId: "B1",
          tier: "flow",
          state: "step",
          itemId: "MADE",
          quantity: 10
        },
        sourceOf("A3", { itemId: "MADE", quantity: 0, need: 0 })
      ],
      station("A3", "out", [shortOf("A3", "MADE", 1)])
    );
    expect(upstream.looseRows[0].cover).toBe("upstream");
    expect(upstream.need).toBe("waiting");

    // No open operation and nothing short.
    expect(
      buildLaneBoard({ stations: [station("A3")], laneRows: [] })[0]
    ).toMatchObject({ need: "idle", severity: "unknown" });
  });

  it("runs lanes in line order, or worst first, and counts their work", () => {
    const stations = [
      station("C", "out", [shortOf("C", "BOLT", 1)]),
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
      bring: 0,
      deliver: 0,
      finish: 0,
      build: 0,
      rawShort: 0
    });
  });
});

describe("buildFlow", () => {
  const stations = ["A1", "A2a", "A2b", "S1", "S2", "KIT", "LATHE", "OLD"].map(
    (id) => ({ workCenterId: id, name: id })
  );
  const step = (
    workCenterId: string,
    itemId: string,
    quantity: number,
    running = true
  ): LaneRowInput => ({
    workCenterId,
    tier: "flow",
    state: "step",
    itemId,
    quantity,
    replenishing: running
  });

  it("lays stations out in routing order, a feeder before the line it feeds", () => {
    const flow = buildFlow(stations, [
      // The engine line: A1, then two parallel A2 stations.
      step("A1", "ENGINE", 10),
      step("A2b", "ENGINE", 20),
      step("A2a", "ENGINE", 20),
      // The sub-assembly line feeds the engine at A2a.
      step("S2", "SUB", 20),
      step("S1", "SUB", 10),
      {
        workCenterId: "A2a",
        tier: "flow",
        state: "feed",
        itemId: "SUB",
        parentKitItemId: "ENGINE",
        quantity: 20
      },
      // A kit bench has a one-step routing.
      step("KIT", "KIT-ITEM", 10),
      // A longer routing with no open job does not take the engine's stations.
      step("A1", "OLD-ENGINE", 10, false),
      step("A2a", "OLD-ENGINE", 20, false),
      step("A2b", "OLD-ENGINE", 20, false),
      step("OLD", "OLD-ENGINE", 30, false)
    ]);
    expect(flow).toEqual([
      { type: "prep", itemId: null, steps: [["KIT"]] },
      {
        type: "line",
        itemId: "SUB",
        steps: [["S1"], ["S2"]],
        feeds: { itemId: "ENGINE", workCenterId: "A2a" }
      },
      { type: "line", itemId: "ENGINE", steps: [["A1"], ["A2a", "A2b"]] },
      { type: "other", itemId: null, steps: [["LATHE", "OLD"]] }
    ]);
  });
});
