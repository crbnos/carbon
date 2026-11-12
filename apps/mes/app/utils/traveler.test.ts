// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  parseTravelerCode,
  pickTravelerOperation,
  travelerIssueCandidates,
  travelerScanAction
} from "./traveler";

describe("parseTravelerCode", () => {
  it("reads the id from a label printed on another origin", () => {
    expect(
      parseTravelerCode("https://mes.try.carbon.ms/x/traveler/te_9k2m1q")
    ).toBe("te_9k2m1q");
  });

  it("returns null for a raw id, the resolve route and other paths", () => {
    expect(parseTravelerCode("te_9k2m1q")).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/traveler/resolve")
    ).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/operation/op_1")
    ).toBeNull();
  });
});

describe("pickTravelerOperation", () => {
  const operations = [
    { id: "op_10", workCenterId: "wc_assy", operationOrder: 10 },
    { id: "op_20a", workCenterId: "wc_test", operationOrder: 20 },
    { id: "op_20b", workCenterId: "wc_test", operationOrder: 20 },
    { id: "op_30", workCenterId: "wc_pack", operationOrder: 30 }
  ];

  it("opens the one operation at the operator's work center", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_pack" })
    ).toEqual({ kind: "open", operationId: "op_30" });
  });

  it("asks the operator to choose between 2 operations at the station", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_test" })
    ).toEqual({ kind: "choose", operationIds: ["op_20a", "op_20b"] });
  });

  it("opens the next operation in routing order with no station match", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_paint" })
    ).toEqual({ kind: "open", operationId: "op_10" });
  });

  it("asks the operator to choose between parallel operations of equal order", () => {
    expect(
      pickTravelerOperation({
        operations: operations.slice(1),
        workCenterId: null
      })
    ).toEqual({ kind: "choose", operationIds: ["op_20a", "op_20b"] });
  });

  it("returns none when the unit has no open operation", () => {
    expect(
      pickTravelerOperation({ operations: [], workCenterId: null })
    ).toEqual({ kind: "none" });
  });
});

describe("travelerIssueCandidates", () => {
  const operations = [
    {
      id: "op_a10",
      jobMakeMethodId: "jmm_a",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: "2026-11-20"
    },
    {
      id: "op_a20",
      jobMakeMethodId: "jmm_a",
      workCenterId: "wc_test",
      operationOrder: 20,
      jobDueDate: "2026-11-20"
    },
    {
      id: "op_b10",
      jobMakeMethodId: "jmm_b",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: "2026-11-15"
    },
    {
      id: "op_c10",
      jobMakeMethodId: "jmm_c",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: null
    }
  ];
  const material = (overrides: {
    jobMakeMethodId: string;
    jobOperationId: string | null;
    quantityIssued?: number | null;
  }) => ({
    quantity: 1,
    estimatedQuantity: 1,
    quantityIssued: 0,
    ...overrides
  });

  it("gives a material with no operation to the last open operation of its make method", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({ jobMakeMethodId: "jmm_a", jobOperationId: null })
        ],
        workCenterId: null
      })
    ).toEqual(["op_a20"]);
  });

  it("skips a fully issued material and one whose operation is not open", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({
            jobMakeMethodId: "jmm_a",
            jobOperationId: "op_a10",
            quantityIssued: 1
          }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_closed" })
        ],
        workCenterId: null
      })
    ).toEqual([]);
  });

  it("orders the station first, then due date with none last, then routing order", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({ jobMakeMethodId: "jmm_c", jobOperationId: "op_c10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a10" }),
          material({ jobMakeMethodId: "jmm_b", jobOperationId: "op_b10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a20" })
        ],
        workCenterId: "wc_test"
      })
    ).toEqual(["op_a20", "op_b10", "op_a10", "op_c10"]);
  });
});

describe("travelerScanAction", () => {
  const base = {
    scannedStatus: "Consumed",
    targetTrackedEntityId: "te_engine",
    targetStatus: "Reserved",
    targetJobMakeMethodId: "jmm_engine",
    operationJobMakeMethodId: "jmm_engine"
  };

  it("issues an available unit", () => {
    expect(
      travelerScanAction({
        ...base,
        scannedStatus: "Available",
        targetTrackedEntityId: "te_chamber",
        targetStatus: "Available",
        targetJobMakeMethodId: null
      })
    ).toEqual({ kind: "issue" });
  });

  it("opens the unit a consumed unit is already inside in this job", () => {
    expect(travelerScanAction(base)).toEqual({
      kind: "open",
      trackedEntityId: "te_engine"
    });
  });

  it("navigates for a unit inside another job", () => {
    expect(
      travelerScanAction({ ...base, targetJobMakeMethodId: "jmm_other" })
    ).toEqual({ kind: "navigate" });
  });
});
