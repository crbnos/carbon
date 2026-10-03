// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  InspectionFeaturePlan,
  InspectionMeasurement,
  InspectionSample
} from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import {
  acceptRemaining,
  buildRows,
  cellKey,
  columnCount,
  completablePassed,
  dispositionGates,
  effectiveMeasurements,
  failedEntityIds,
  failureSummary,
  featureCounts,
  gaugeLabel,
  gaugeOptions,
  isEntityOpenAtOperation,
  isOutOfCalibration,
  liveFeatures,
  lotClosed,
  matchUnitByScan,
  maxSampleSize,
  OVERALL_ROW_ID,
  openEntityIds,
  operationRemaining,
  parseSpecNumber,
  sampleStatuses,
  specLabel,
  statusTally,
  unsampledUnits
} from "./logic";

type Feature = NonNullable<InspectionFeaturePlan["inspectionFeature"]>;

const feature = (over: Partial<Feature> = {}) =>
  ({
    id: "f1",
    label: "Ø2",
    type: "Measurement",
    nominalValue: "0.250",
    ...over
  }) as Feature;

const plan = (
  over: Partial<InspectionFeaturePlan> = {},
  featureOver: Partial<Feature> = {}
) =>
  ({
    id: `p-${featureOver.id ?? "f1"}`,
    inspectionFeatureId: featureOver.id ?? "f1",
    sampleSize: 2,
    acceptanceNumber: 0,
    rejectionNumber: 1,
    inspectionFeature: feature(featureOver),
    ...over
  }) as InspectionFeaturePlan;

const measurement = (
  sampleId: string,
  featureId: string,
  status: string,
  value: number | null = null
) =>
  ({
    id: `m-${sampleId}-${featureId}`,
    inspectionSampleId: sampleId,
    inspectionFeatureId: featureId,
    status,
    value
  }) as InspectionMeasurement;

const sample = (id: string, status: string, trackedEntityId?: string) =>
  ({
    id,
    status,
    trackedEntityId: trackedEntityId ?? null
  }) as InspectionSample;

describe("parseSpecNumber", () => {
  it("reads a decimal and strips a leading plus", () => {
    expect(parseSpecNumber("0.250")).toBe(0.25);
    expect(parseSpecNumber("+0.005")).toBe(0.005);
    expect(parseSpecNumber("  1.5 ")).toBe(1.5);
  });

  it("is null for anything that is not a number", () => {
    // These are real specifications: the column is TEXT because a drawing may
    // call out a fraction or a condition, and such a characteristic must fall
    // through to pass/fail rather than becoming NaN.
    expect(parseSpecNumber("1/4")).toBeNull();
    expect(parseSpecNumber("FLAT")).toBeNull();
    expect(parseSpecNumber("")).toBeNull();
    expect(parseSpecNumber("   ")).toBeNull();
    expect(parseSpecNumber(null)).toBeNull();
    expect(parseSpecNumber(undefined)).toBeNull();
  });
});

describe("specLabel", () => {
  it("joins nominal, tolerance pair and unit", () => {
    expect(
      specLabel(
        feature({ tolerancePlus: "0.005", toleranceMinus: "0.002", unit: "in" })
      )
    ).toBe("0.250 +0.005/−0.002 in");
  });

  it("defaults a missing side of the pair to zero", () => {
    expect(specLabel(feature({ tolerancePlus: "0.005" }))).toBe(
      "0.250 +0.005/−0"
    );
  });

  it("omits the tolerance clause when neither side is set", () => {
    expect(specLabel(feature({ unit: "mm" }))).toBe("0.250 mm");
  });
});

describe("liveFeatures", () => {
  it("drops a plan row whose feature was deleted from the document", () => {
    const rows = liveFeatures([
      plan({}, { id: "a" }),
      plan({ inspectionFeature: null }, { id: "b" })
    ]);
    expect(rows.map((r) => r.inspectionFeatureId)).toEqual(["a"]);
  });

  it("sorts by page then label with numeric collation", () => {
    // Plain string order puts "Ø10" before "Ø2"; a drawing reads the other way.
    const rows = liveFeatures([
      plan({}, { id: "c", label: "Ø10", pageNumber: 1 }),
      plan({}, { id: "a", label: "Ø2", pageNumber: 1 }),
      plan({}, { id: "b", label: "Ø1", pageNumber: 2 })
    ]);
    expect(rows.map((r) => r.inspectionFeatureId)).toEqual(["a", "c", "b"]);
  });

  it("treats a missing page number as page one", () => {
    const rows = liveFeatures([
      plan({}, { id: "second", label: "B", pageNumber: 2 }),
      plan({}, { id: "first", label: "A" })
    ]);
    expect(rows.map((r) => r.inspectionFeatureId)).toEqual(["first", "second"]);
  });

  it("does not mutate the input order", () => {
    const input = [
      plan({}, { id: "b", label: "B" }),
      plan({}, { id: "a", label: "A" })
    ];
    liveFeatures(input);
    expect(input.map((r) => r.inspectionFeatureId)).toEqual(["b", "a"]);
  });
});

describe("buildRows", () => {
  const lot = { sampleSize: 5, acceptanceNumber: 1, rejectionNumber: 2 };

  it("collapses to the overall-result row when the lot has no characteristics", () => {
    const rows = buildRows([], lot, "Overall result");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.featureId).toBe(OVERALL_ROW_ID);
    expect(rows[0]?.isNumeric).toBe(false);
    // The synthetic row is judged by the LOT's plan, not a feature's.
    expect(rows[0]?.sampleSize).toBe(5);
    expect(rows[0]?.acceptanceNumber).toBe(1);
    expect(rows[0]?.rejectionNumber).toBe(2);
  });

  it("is numeric only for a Measurement with a parseable nominal", () => {
    const [numeric] = buildRows([plan()], lot, "Overall result");
    expect(numeric?.isNumeric).toBe(true);

    const [fraction] = buildRows(
      [plan({}, { nominalValue: "1/4" })],
      lot,
      "Overall result"
    );
    expect(fraction?.isNumeric).toBe(false);

    const [attribute] = buildRows(
      [plan({}, { type: "Attribute", nominalValue: "0.250" })],
      lot,
      "Overall result"
    );
    expect(attribute?.isNumeric).toBe(false);
  });

  it("carries the lot's recorded gauge and the required gauge type", () => {
    const [row] = buildRows(
      [plan({ gaugeId: "g1" }, { gaugeTypeId: "gt1" })],
      lot,
      "Overall result"
    );
    expect(row?.gaugeId).toBe("g1");
    expect(row?.gaugeTypeId).toBe("gt1");
  });

  it("falls back to the feature id when it has no label", () => {
    const [row] = buildRows(
      [plan({}, { id: "f9", label: null })],
      lot,
      "Overall result"
    );
    expect(row?.label).toBe("f9");
  });
});

describe("maxSampleSize", () => {
  it("is the largest n any characteristic requires", () => {
    expect(
      maxSampleSize(
        [
          plan({ sampleSize: 2 }, { id: "a" }),
          plan({ sampleSize: 8 }, { id: "b" })
        ],
        { sampleSize: 3 }
      )
    ).toBe(8);
  });

  it("falls back to the lot's own n with no characteristics", () => {
    expect(maxSampleSize([], { sampleSize: 3 })).toBe(3);
  });

  it("is at least one even if a plan row asks for none", () => {
    expect(maxSampleSize([plan({ sampleSize: 0 })], { sampleSize: 9 })).toBe(1);
  });
});

describe("columnCount", () => {
  it("gives a serial lot exactly the units it has scanned", () => {
    expect(
      columnCount({
        isSerial: true,
        sampleCount: 3,
        lotSize: 50,
        maxSampleSize: 8
      })
    ).toBe(3);
  });

  it("offers the required n plus one spare", () => {
    // n is a MINIMUM: the spare is how an extra reading gets a column, since a
    // sample row is only created server-side by the first write into it.
    expect(
      columnCount({
        isSerial: false,
        sampleCount: 0,
        lotSize: 50,
        maxSampleSize: 5
      })
    ).toBe(5);
    expect(
      columnCount({
        isSerial: false,
        sampleCount: 5,
        lotSize: 50,
        maxSampleSize: 5
      })
    ).toBe(6);
  });

  it("never exceeds the lot size", () => {
    expect(
      columnCount({
        isSerial: false,
        sampleCount: 3,
        lotSize: 3,
        maxSampleSize: 8
      })
    ).toBe(3);
  });
});

describe("effectiveMeasurements", () => {
  it("keys the server's rows by sample and feature", () => {
    const map = effectiveMeasurements(
      [measurement("s1", "f1", "Passed", 0.251)],
      {}
    );
    expect(map.get("s1:f1")).toEqual({
      featureId: "f1",
      status: "Passed",
      value: 0.251
    });
  });

  it("lets a local patch win over the server's row", () => {
    // This is what makes a per-cell save free: the write's own result is kept
    // rather than refetching the whole screen.
    const map = effectiveMeasurements(
      [measurement("s1", "f1", "Passed", 0.251)],
      { "s1:f1": { status: "Failed", value: 0.9 } }
    );
    expect(map.get("s1:f1")).toEqual({
      featureId: "f1",
      status: "Failed",
      value: 0.9
    });
  });

  it("carries a patch for a cell the server has never seen", () => {
    const map = effectiveMeasurements([], {
      "s2:f1": { status: "Passed", value: 1 }
    });
    expect(map.get("s2:f1")?.featureId).toBe("f1");
  });

  it("reads a null reading as null, not zero", () => {
    // An attribute characteristic stores no value; Number(null) would be 0 and
    // would render as a real reading of zero.
    const map = effectiveMeasurements([measurement("s1", "f1", "Passed")], {});
    expect(map.get("s1:f1")?.value).toBeNull();
  });
});

describe("featureCounts", () => {
  it("counts recorded and failed, with Pending as neither", () => {
    const features = [plan({}, { id: "f1" })];
    const counts = featureCounts(
      features,
      effectiveMeasurements(
        [
          measurement("s1", "f1", "Passed"),
          measurement("s2", "f1", "Failed"),
          measurement("s3", "f1", "Pending")
        ],
        {}
      )
    );
    expect(counts.get("f1")).toEqual({ recorded: 2, failed: 1 });
  });

  it("ignores a reading for a characteristic not in the plan", () => {
    const counts = featureCounts(
      [plan({}, { id: "f1" })],
      effectiveMeasurements([measurement("s1", "gone", "Failed")], {})
    );
    expect(counts.get("f1")).toEqual({ recorded: 0, failed: 0 });
    expect(counts.has("gone")).toBe(false);
  });
});

describe("sampleStatuses and statusTally", () => {
  it("applies a patch over the server's status", () => {
    const statuses = sampleStatuses(
      [sample("s1", "Pending"), sample("s2", "Passed")],
      { s1: "Failed" }
    );
    expect(statuses.get("s1")).toBe("Failed");
    expect(statusTally(statuses)).toEqual({
      passes: 1,
      fails: 1,
      inspected: 2
    });
  });

  it("does not count Pending as inspected", () => {
    const statuses = sampleStatuses([sample("s1", "Pending")], {});
    expect(statusTally(statuses)).toEqual({
      passes: 0,
      fails: 0,
      inspected: 0
    });
  });
});

describe("lotClosed", () => {
  const lot = (over: Record<string, unknown>) =>
    over as Parameters<typeof lotClosed>[0];

  it("is closed only with a disposition AND a terminal status", () => {
    expect(
      lotClosed(lot({ status: "Passed", dispositionedAt: "2026-10-03" }))
    ).toBe(true);
    // Partial is hard-terminal too — there is no reopening a lot.
    expect(
      lotClosed(lot({ status: "Partial", dispositionedAt: "2026-10-03" }))
    ).toBe(true);
    expect(lotClosed(lot({ status: "Passed", dispositionedAt: null }))).toBe(
      false
    );
    expect(
      lotClosed(lot({ status: "In Progress", dispositionedAt: "2026-10-03" }))
    ).toBe(false);
  });
});

describe("operationRemaining", () => {
  const op = (over: Record<string, unknown>) =>
    over as Parameters<typeof operationRemaining>[0];

  it("does not let scrap reduce what is still owed", () => {
    // A scrapped unit still has to be replaced, so the remainder stands.
    expect(
      operationRemaining(
        op({ targetQuantity: 10, quantityComplete: 2, quantityScrapped: 3 })
      )
    ).toBe(8);
  });

  it("lets rework reduce it", () => {
    expect(
      operationRemaining(
        op({ targetQuantity: 10, quantityComplete: 2, quantityReworked: 3 })
      )
    ).toBe(5);
  });

  it("falls back to the operation quantity and never goes negative", () => {
    expect(operationRemaining(op({ operationQuantity: 4 }))).toBe(4);
    expect(
      operationRemaining(op({ targetQuantity: 2, quantityComplete: 5 }))
    ).toBe(0);
  });
});

describe("dispositionGates", () => {
  const lot = { sampleSize: 3, acceptanceNumber: 1 };

  it("accepts a featured lot only when every characteristic is satisfied", () => {
    const features = [
      plan(
        { sampleSize: 2, acceptanceNumber: 0, rejectionNumber: 1 },
        { id: "a" }
      ),
      plan(
        { sampleSize: 2, acceptanceNumber: 0, rejectionNumber: 1 },
        { id: "b" }
      )
    ];
    const short = new Map([
      ["a", { recorded: 2, failed: 0 }],
      ["b", { recorded: 1, failed: 0 }]
    ]);
    expect(
      dispositionGates({
        closed: false,
        features,
        counts: short,
        lot,
        tally: { fails: 0, inspected: 2 }
      }).canAccept
    ).toBe(false);

    const done = new Map([
      ["a", { recorded: 2, failed: 0 }],
      ["b", { recorded: 2, failed: 0 }]
    ]);
    expect(
      dispositionGates({
        closed: false,
        features,
        counts: done,
        lot,
        tally: { fails: 0, inspected: 2 }
      }).canAccept
    ).toBe(true);
  });

  it("rejects a featured lot when one characteristic reaches its rejection number", () => {
    const features = [
      plan(
        { sampleSize: 2, acceptanceNumber: 0, rejectionNumber: 1 },
        { id: "a" }
      )
    ];
    const gates = dispositionGates({
      closed: false,
      features,
      counts: new Map([["a", { recorded: 2, failed: 1 }]]),
      lot,
      tally: { fails: 0, inspected: 2 }
    });
    // One failed reading is past acceptance, so accept is off and reject is on
    // even though no SAMPLE carries a Failed verdict.
    expect(gates.canAccept).toBe(false);
    expect(gates.canReject).toBe(true);
  });

  it("gates a lot with no characteristics on the lot's own numbers", () => {
    const features: InspectionFeaturePlan[] = [];
    expect(
      dispositionGates({
        closed: false,
        features,
        counts: new Map(),
        lot,
        tally: { fails: 1, inspected: 3 }
      })
    ).toEqual({ canAccept: true, canReject: false });

    // One more failure than the lot accepts flips both.
    expect(
      dispositionGates({
        closed: false,
        features,
        counts: new Map(),
        lot,
        tally: { fails: 2, inspected: 3 }
      })
    ).toEqual({ canAccept: false, canReject: true });

    // Not enough units inspected yet.
    expect(
      dispositionGates({
        closed: false,
        features,
        counts: new Map(),
        lot,
        tally: { fails: 0, inspected: 2 }
      }).canAccept
    ).toBe(false);
  });

  it("offers nothing on a closed lot", () => {
    const gates = dispositionGates({
      closed: true,
      features: [],
      counts: new Map(),
      lot,
      tally: { fails: 2, inspected: 3 }
    });
    expect(gates).toEqual({ canAccept: false, canReject: false });
  });
});

describe("isEntityOpenAtOperation", () => {
  it("is closed by a terminal unit status", () => {
    for (const status of ["Consumed", "Rejected", "Scrapped"]) {
      expect(isEntityOpenAtOperation({ status }, "op1")).toBe(false);
    }
  });

  it("is closed by this operation's own completion marker", () => {
    expect(
      isEntityOpenAtOperation(
        { status: "Available", attributes: { "Operation op1": true } },
        "op1"
      )
    ).toBe(false);
  });

  it("ignores another operation's marker", () => {
    expect(
      isEntityOpenAtOperation(
        { status: "Available", attributes: { "Operation op2": true } },
        "op1"
      )
    ).toBe(true);
  });

  it("treats a unit with no attributes as open", () => {
    expect(isEntityOpenAtOperation({ status: "Available" }, "op1")).toBe(true);
  });

  it("collects the open ids", () => {
    const ids = openEntityIds(
      [
        { id: "a", status: "Available" },
        { id: "b", status: "Scrapped" },
        { id: "c", status: "Available", attributes: { "Operation op1": true } }
      ],
      "op1"
    );
    expect([...ids]).toEqual(["a"]);
  });
});

describe("completablePassed", () => {
  it("counts a serial lot's passed units that are still open and unposted", () => {
    const samples = [
      sample("s1", "Passed", "e1"),
      sample("s2", "Passed", "e2"),
      sample("s3", "Passed", "e3"),
      sample("s4", "Failed", "e4")
    ];
    expect(
      completablePassed({
        isSerial: true,
        samples,
        statuses: sampleStatuses(samples, {}),
        // s2 is already posted, e3 is no longer open, s4 failed.
        linkedSampleIds: ["s2"],
        openEntityIds: new Set(["e1", "e2", "e4"]),
        passes: 3,
        linkedProductionQuantity: 1,
        remaining: 10
      })
    ).toBe(1);
  });

  it("ignores a serial sample with no unit attached", () => {
    const samples = [sample("s1", "Passed")];
    expect(
      completablePassed({
        isSerial: true,
        samples,
        statuses: sampleStatuses(samples, {}),
        linkedSampleIds: [],
        openEntityIds: new Set(["e1"]),
        passes: 1,
        linkedProductionQuantity: 0,
        remaining: 10
      })
    ).toBe(0);
  });

  it("nets a non-serial lot against what is posted and clamps to the remainder", () => {
    expect(
      completablePassed({
        isSerial: false,
        samples: [],
        statuses: new Map(),
        linkedSampleIds: [],
        openEntityIds: new Set(),
        passes: 7,
        linkedProductionQuantity: 2,
        remaining: 3
      })
    ).toBe(3);
  });

  it("never goes negative when more is posted than passed", () => {
    expect(
      completablePassed({
        isSerial: false,
        samples: [],
        statuses: new Map(),
        linkedSampleIds: [],
        openEntityIds: new Set(),
        passes: 1,
        linkedProductionQuantity: 4,
        remaining: 10
      })
    ).toBe(0);
  });
});

describe("failureSummary", () => {
  it("lists each failed reading under its characteristic", () => {
    const features = [
      plan({}, { id: "f1", label: "Ø2", unit: "in", tolerancePlus: "0.005" })
    ];
    const summary = failureSummary(
      features,
      effectiveMeasurements(
        [
          measurement("s1", "f1", "Failed", 0.31),
          measurement("s2", "f1", "Passed", 0.25)
        ],
        {}
      )
    );
    expect(summary).toEqual([
      {
        label: "Ø2",
        spec: "0.250 +0.005/−0 in",
        failedValues: ["0.31"]
      }
    ]);
  });

  it("shows an attribute failure as F rather than a number", () => {
    const summary = failureSummary(
      [plan({}, { id: "f1", type: "Attribute" })],
      effectiveMeasurements([measurement("s1", "f1", "Failed")], {})
    );
    expect(summary[0]?.failedValues).toEqual(["F"]);
  });

  it("omits a characteristic with no failures, and is empty with no plan", () => {
    expect(
      failureSummary(
        [plan({}, { id: "f1" })],
        effectiveMeasurements([measurement("s1", "f1", "Passed", 0.25)], {})
      )
    ).toEqual([]);
    expect(failureSummary([], new Map())).toEqual([]);
  });
});

describe("cellKey", () => {
  it("keys on the column INDEX, because a spare column has no sample id yet", () => {
    expect(cellKey(2, "f1")).toBe("2:f1");
  });
});

describe("gaugeOptions", () => {
  const gauge = (over: Record<string, unknown>) =>
    ({
      id: "g1",
      gaugeId: "CAL-001",
      gaugeStatus: "Active",
      gaugeTypeId: "gt1",
      ...over
    }) as Parameters<typeof gaugeOptions>[0][number];

  it("offers only Active gauges of the required type", () => {
    const { recent, rest } = gaugeOptions(
      [
        gauge({ id: "ok" }),
        gauge({ id: "inactive", gaugeStatus: "Inactive" }),
        gauge({ id: "wrong-type", gaugeTypeId: "gt2" })
      ],
      [],
      "gt1"
    );
    expect(recent).toEqual([]);
    expect(rest.map((g) => g.id)).toEqual(["ok"]);
  });

  it("offers every Active gauge when the characteristic names no type", () => {
    const { rest } = gaugeOptions(
      [
        gauge({ id: "a", gaugeTypeId: "gt1" }),
        gauge({ id: "b", gaugeTypeId: "gt2" })
      ],
      [],
      null
    );
    expect(rest.map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("lifts the recently used ones out, keeping the server's order", () => {
    // Most-recent-first is the whole value of the list, so it is never sorted.
    const { recent, rest } = gaugeOptions(
      [gauge({ id: "a" }), gauge({ id: "b" }), gauge({ id: "c" })],
      ["c", "a"],
      "gt1"
    );
    expect(recent.map((g) => g.id)).toEqual(["c", "a"]);
    expect(rest.map((g) => g.id)).toEqual(["b"]);
  });

  it("ignores a recent id that is no longer eligible", () => {
    const { recent, rest } = gaugeOptions(
      [gauge({ id: "a" }), gauge({ id: "retired", gaugeStatus: "Inactive" })],
      ["retired", "a"],
      "gt1"
    );
    expect(recent.map((g) => g.id)).toEqual(["a"]);
    expect(rest).toEqual([]);
  });
});

describe("isOutOfCalibration and gaugeLabel", () => {
  const gauge = (over: Record<string, unknown>) =>
    ({ id: "g1", ...over }) as Parameters<typeof isOutOfCalibration>[0];

  it("flags a lapsed gauge without hiding it", () => {
    expect(
      isOutOfCalibration(
        gauge({ gaugeCalibrationStatusWithDueDate: "Out-of-Calibration" })
      )
    ).toBe(true);
    expect(
      isOutOfCalibration(
        gauge({ gaugeCalibrationStatusWithDueDate: "In-Calibration" })
      )
    ).toBe(false);
  });

  it("names a gauge by its id, falling back to its description", () => {
    expect(gaugeLabel(gauge({ gaugeId: "CAL-001" }))).toBe("CAL-001");
    expect(gaugeLabel(gauge({ description: "0-1in mic" }))).toBe("0-1in mic");
    expect(gaugeLabel(gauge({}))).toBe("g1");
    expect(gaugeLabel(undefined)).toBeNull();
  });
});

describe("matchUnitByScan", () => {
  const units = [
    { id: "te_1", readableId: "SN-0001" },
    { id: "te_2", readableId: null }
  ];

  it("matches a readable id regardless of case and padding", () => {
    expect(matchUnitByScan(units, " sn-0001 ")?.id).toBe("te_1");
    expect(matchUnitByScan(units, "SN-0001")?.id).toBe("te_1");
  });

  it("matches the raw id, which a Carbon QR code carries", () => {
    expect(matchUnitByScan(units, "te_2")?.id).toBe("te_2");
  });

  it("matches nothing for an unknown or empty code", () => {
    expect(matchUnitByScan(units, "SN-9999")).toBeUndefined();
    expect(matchUnitByScan(units, "   ")).toBeUndefined();
  });
});

describe("unsampledUnits", () => {
  it("drops the units already sampled", () => {
    const units = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const samples = [sample("s1", "Passed", "b")];
    expect(unsampledUnits(units, samples).map((u) => u.id)).toEqual(["a", "c"]);
  });

  it("ignores an anonymous sample, which claims no unit", () => {
    const units = [{ id: "a" }];
    expect(
      unsampledUnits(units, [sample("s1", "Passed")]).map((u) => u.id)
    ).toEqual(["a"]);
  });
});

describe("acceptRemaining", () => {
  it("is the operation's remainder on a lot that is not serial", () => {
    expect(
      acceptRemaining({
        isSerial: false,
        trackedEntities: [],
        samples: [],
        statuses: new Map(),
        operationId: "op1",
        remaining: 7
      })
    ).toBe(7);
  });

  it("counts the open serial units that have not failed", () => {
    // Deliberately NOT the operation's remainder: once a unit has failed, the
    // two diverge, and this number is read just before a one-shot close.
    const samples = [sample("s1", "Failed", "b")];
    expect(
      acceptRemaining({
        isSerial: true,
        trackedEntities: [
          { id: "a", status: "Available" },
          { id: "b", status: "Available" },
          {
            id: "c",
            status: "Available",
            attributes: { "Operation op1": true }
          },
          { id: "d", status: "Scrapped" }
        ],
        samples,
        statuses: sampleStatuses(samples, {}),
        operationId: "op1",
        remaining: 99
      })
    ).toBe(1);
  });
});

describe("failedEntityIds", () => {
  it("collects only the units a failed sample names", () => {
    const samples = [
      sample("s1", "Failed", "a"),
      sample("s2", "Passed", "b"),
      // A failed ANONYMOUS sample names no unit and must not be collected.
      sample("s3", "Failed")
    ];
    expect([...failedEntityIds(samples, sampleStatuses(samples, {}))]).toEqual([
      "a"
    ]);
  });
});
