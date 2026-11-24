// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  batchScanQuantity,
  captureIssueSerial,
  decideTravelerClaim,
  findScannedUnit,
  issueSerialChildren,
  isUnitInOperationScope,
  parseTravelerCode,
  pickTravelerClaims,
  pickTravelerMaterial,
  pickTravelerOperation,
  travelerIssueCandidates
} from "./traveler";

describe("parseTravelerCode", () => {
  it("reads the id from a label printed on another origin", () => {
    expect(
      parseTravelerCode("https://mes.try.carbon.ms/x/traveler/te_9k2m1q")
    ).toBe("te_9k2m1q");
  });

  it("returns null for a raw id, the scan endpoint and other paths", () => {
    expect(parseTravelerCode("te_9k2m1q")).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/traveler/scan")
    ).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/operation/op_1")
    ).toBeNull();
  });
});

describe("findScannedUnit", () => {
  const stock = [
    { id: "one", readableId: "SN-123" },
    { id: "two", readableId: " SN-123 " }
  ];
  it("resolves bare serials exactly and refuses an ambiguous printed number", () => {
    expect(findScannedUnit(stock, "SN-123")).toBe(stock[0]);
    expect(findScannedUnit(stock, " SN-123 ")).toBe(stock[1]);
    const duplicated = [...stock, { id: "three", readableId: "SN-123" }];
    expect(findScannedUnit(duplicated, "SN-123")).toBeUndefined();
    expect(
      findScannedUnit(duplicated, "https://labels.test/x/traveler/one")
    ).toBe(stock[0]);
    expect(findScannedUnit(duplicated, "three")).toBe(duplicated[2]);
  });
});

it("keeps the same physical id and exact label when a later refresh moves the label to another piece", () => {
  const stock = [
    { id: "one", readableId: " SN " },
    { id: "two", readableId: "SN" }
  ];
  const typed = captureIssueSerial(stock, " SN ");
  const selected = captureIssueSerial(stock, "one");
  stock[0]!.readableId = "RENAMED";
  stock[1]!.readableId = " SN ";
  expect(typed).toEqual({ observedId: "one", expectedSerial: " SN " });
  expect(selected).toEqual(typed);
  expect(captureIssueSerial(stock, " SN ")).toEqual({
    observedId: "two",
    expectedSerial: " SN "
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

  it("gives a material with no operation to the first open operation of its make method", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({ jobMakeMethodId: "jmm_a", jobOperationId: null })
        ],
        workCenterId: null
      })
    ).toEqual(["op_a10"]);
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

  it("leaves a serial make method's job-level shortfall to the per-unit check", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({
            jobMakeMethodId: "jmm_a",
            jobOperationId: "op_a10",
            quantityIssued: 1
          })
        ],
        workCenterId: null,
        perUnitMakeMethodIds: new Set(["jmm_a"])
      })
    ).toEqual(["op_a10"]);
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

describe("pickTravelerClaims", () => {
  // A chamber job of 3 serial units; the kit is fitted at op_fit.
  const kit = {
    id: "jm_kit",
    jobMakeMethodId: "jmm_cc",
    jobOperationId: "op_fit",
    quantity: 1,
    estimatedQuantity: 3,
    quantityIssued: 0
  };
  const base = {
    operations: [{ id: "op_fit", jobMakeMethodId: "jmm_cc" }],
    unitIds: new Map([["jmm_cc", ["u1", "u2", "u3"]]]),
    isOpenAt: () => true,
    serialMakeMethodIds: new Set(["jmm_cc"]),
    materials: [kit],
    itemId: "item_kit",
    consumed: new Map()
  };
  const hasKit = [{ materialId: "jm_kit", itemId: "item_kit", quantity: 1 }];

  it("claims the first unit for the first kit", () => {
    expect(pickTravelerClaims(base)).toEqual([
      {
        operationId: "op_fit",
        parentTrackedEntityId: "u1",
        materialId: "jm_kit"
      }
    ]);
  });

  it("gives the next kit the next unit while earlier kits are still in work", () => {
    const consumed = new Map([
      ["u1", hasKit],
      ["u2", hasKit]
    ]);
    expect(pickTravelerClaims({ ...base, consumed })[0]).toMatchObject({
      parentTrackedEntityId: "u3"
    });
  });

  it("prefers the unit on screen when it still needs the kit", () => {
    expect(
      pickTravelerClaims({ ...base, preferredUnitId: "u2" })[0]
    ).toMatchObject({ parentTrackedEntityId: "u2" });
  });

  it("moves past the unit on screen when it already has its kit", () => {
    const consumed = new Map([["u2", hasKit]]);
    expect(
      pickTravelerClaims({ ...base, consumed, preferredUnitId: "u2" })[0]
    ).toMatchObject({ parentTrackedEntityId: "u1" });
  });

  it("skips units already done at the operation", () => {
    expect(
      pickTravelerClaims({ ...base, isOpenAt: (unitId) => unitId === "u3" })[0]
    ).toMatchObject({ parentTrackedEntityId: "u3" });
  });

  it("offers nothing once every unit has its kit", () => {
    const consumed = new Map([
      ["u1", hasKit],
      ["u2", hasKit],
      ["u3", hasKit]
    ]);
    expect(pickTravelerClaims({ ...base, consumed })).toEqual([]);
  });

  it("issues a non-serial job's next unit against the job's need", () => {
    const batch = { ...kit, jobMakeMethodId: "jmm_b", quantityIssued: 2 };
    const claims = pickTravelerClaims({
      ...base,
      operations: [{ id: "op_fit", jobMakeMethodId: "jmm_b" }],
      unitIds: new Map([["jmm_b", ["lot"]]]),
      serialMakeMethodIds: new Set<string>(),
      materials: [batch]
    });
    expect(claims).toEqual([
      {
        operationId: "op_fit",
        parentTrackedEntityId: "lot",
        materialId: "jm_kit"
      }
    ]);
    expect(
      pickTravelerClaims({
        ...base,
        operations: [{ id: "op_fit", jobMakeMethodId: "jmm_b" }],
        unitIds: new Map([["jmm_b", ["lot"]]]),
        serialMakeMethodIds: new Set<string>(),
        materials: [{ ...batch, quantityIssued: 3 }]
      })
    ).toEqual([]);
  });

  it("keeps the operations' order, one claim each", () => {
    const claims = pickTravelerClaims({
      ...base,
      operations: [
        { id: "op_b", jobMakeMethodId: "jmm_cc2" },
        { id: "op_fit", jobMakeMethodId: "jmm_cc" }
      ],
      unitIds: new Map([
        ["jmm_cc", ["u1", "u2"]],
        ["jmm_cc2", ["v1"]]
      ]),
      serialMakeMethodIds: new Set(["jmm_cc", "jmm_cc2"]),
      materials: [
        kit,
        {
          ...kit,
          id: "jm_kit2",
          jobMakeMethodId: "jmm_cc2",
          jobOperationId: "op_b"
        }
      ]
    });
    expect(claims.map((c) => c.parentTrackedEntityId)).toEqual(["v1", "u1"]);
  });
});

describe("decideTravelerClaim", () => {
  // The server's claims, best first: unit 1 needs the part, so it leads.
  const claim = (
    parentTrackedEntityId: string,
    over: { laterSerial?: boolean; workCenterId?: string | null } = {}
  ) => ({
    parentTrackedEntityId,
    laterSerial: over.laterSerial ?? false,
    operation: { workCenterId: over.workCenterId ?? "wc_a3" }
  });
  const base = {
    onOperationPage: false,
    heldUnitId: null as string | null,
    isSerial: true,
    workCenterId: "wc_a3" as string | null,
    options: [claim("SN-1"), claim("SN-3", { workCenterId: "wc_m" })]
  };
  const later = [
    claim("SN-1", { laterSerial: true }),
    claim("SN-3", { laterSerial: true })
  ];

  it("claims a kit at the operator's station", () => {
    expect(decideTravelerClaim(base)).toEqual({
      kind: "claim",
      options: base.options,
      auto: true
    });
  });

  it("asks when the best claim is at another station", () => {
    const options = [claim("SN-3", { workCenterId: "wc_m" })];
    expect(decideTravelerClaim({ ...base, options })).toEqual({
      kind: "claim",
      options,
      auto: false
    });
  });

  it("claims the one place that needs it for an operator with no station", () => {
    const options = [claim("SN-3", { workCenterId: "wc_m" })];
    expect(
      decideTravelerClaim({ ...base, workCenterId: null, options })
    ).toEqual({ kind: "claim", options, auto: true });
    expect(decideTravelerClaim({ ...base, workCenterId: null })).toEqual({
      kind: "claim",
      options: base.options,
      auto: false
    });
  });

  it("asks before issuing a batch lot from the board", () => {
    expect(decideTravelerClaim({ ...base, isSerial: false })).toEqual({
      kind: "claim",
      options: base.options,
      auto: false
    });
  });

  it("claims on an operation page, inside that operation", () => {
    expect(
      decideTravelerClaim({ ...base, onOperationPage: true, isSerial: false })
    ).toEqual({ kind: "claim", options: base.options, auto: true });
  });

  it("asks for the unit on a later serial operation with none held", () => {
    expect(
      decideTravelerClaim({ ...base, onOperationPage: true, options: later })
    ).toEqual({ kind: "pickUnit" });
  });

  it("issues only into the held unit on a later serial operation, never the server's first choice", () => {
    expect(
      decideTravelerClaim({
        ...base,
        onOperationPage: true,
        heldUnitId: "SN-3",
        options: later
      })
    ).toEqual({ kind: "claim", options: [later[1]], auto: true });
  });

  it("issues nowhere when the held unit does not need the part", () => {
    expect(
      decideTravelerClaim({
        ...base,
        onOperationPage: true,
        heldUnitId: "SN-2",
        options: later
      })
    ).toEqual({ kind: "claim", options: [], auto: true });
  });

  it("never takes a later serial claim unasked off the operation page, even at the operator's station", () => {
    expect(decideTravelerClaim({ ...base, options: later })).toEqual({
      kind: "claim",
      options: later,
      auto: false
    });
  });

  it("still takes a first-operation claim at the station when a later one is also offered", () => {
    const options = [claim("SN-1"), claim("SN-7", { laterSerial: true })];
    expect(decideTravelerClaim({ ...base, options })).toEqual({
      kind: "claim",
      options,
      auto: true
    });
  });
});

describe("pickTravelerMaterial", () => {
  // The merge station of the AJ-3 engine: 1 combustion chamber per unit.
  const base = (overrides: {
    id: string;
    jobOperationId: string | null;
    quantity?: number;
    estimatedQuantity?: number | null;
    quantityIssued?: number | null;
  }) => ({
    quantity: 1,
    estimatedQuantity: 4,
    quantityIssued: 0,
    ...overrides
  });
  const atMerge = base({ id: "jm_cc", jobOperationId: "op_merge" });
  const unassigned = base({ id: "jm_spare", jobOperationId: null });
  const chamber = (materialId: string, quantity: number) => ({
    materialId,
    itemId: "item_chamber",
    quantity
  });

  it("refuses a second chamber for a unit that already has one", () => {
    expect(
      pickTravelerMaterial({
        materials: [atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_cc", 1)]
      })
    ).toEqual({ kind: "full" });
  });

  it("issues into this operation's material while the unit still needs it", () => {
    expect(
      pickTravelerMaterial({
        materials: [unassigned, atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: []
      })
    ).toEqual({ kind: "issue", material: atMerge, needed: 1 });
  });

  it("takes the unassigned material once this operation's is in the unit", () => {
    expect(
      pickTravelerMaterial({
        materials: [atMerge, unassigned],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_cc", 1)]
      })
    ).toEqual({ kind: "issue", material: unassigned, needed: 1 });
  });

  it("counts a chamber booked to another material of the item", () => {
    // The Issue dialog's issue by item books to a new 0-quantity material.
    expect(
      pickTravelerMaterial({
        materials: [
          atMerge,
          base({ id: "jm_extra", jobOperationId: "op_merge", quantity: 0 })
        ],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_extra", 1)]
      })
    ).toEqual({ kind: "full" });
  });

  it("does not count a fitted bolt against the chamber", () => {
    // The bolt was consumed into the unit through the bolt's own material,
    // which is not a chamber material.
    expect(
      pickTravelerMaterial({
        materials: [atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [
          { materialId: "jm_bolt", itemId: "item_bolt", quantity: 1 }
        ]
      })
    ).toEqual({ kind: "issue", material: atMerge, needed: 1 });
  });

  // 2 kg of plate per unit, 0.5 kg already in this unit.
  it("needs only what a serial unit does not hold yet", () => {
    const plate = base({
      id: "jm_plate",
      jobOperationId: "op_merge",
      quantity: 2
    });
    expect(
      pickTravelerMaterial({
        materials: [plate],
        jobOperationId: "op_merge",
        itemId: "item_plate",
        unitConsumed: [
          { materialId: "jm_plate", itemId: "item_plate", quantity: 0.5 }
        ]
      })
    ).toEqual({ kind: "issue", material: plate, needed: 1.5 });
  });

  it("gives an untracked parent what the job has not issued", () => {
    expect(
      pickTravelerMaterial({
        materials: [{ ...atMerge, quantityIssued: 3 }],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: null
      })
    ).toEqual({
      kind: "issue",
      material: { ...atMerge, quantityIssued: 3 },
      needed: 1
    });
    expect(
      pickTravelerMaterial({
        materials: [{ ...atMerge, quantityIssued: 4 }],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: null
      })
    ).toEqual({ kind: "full" });
  });

  it("refuses an item only another operation uses", () => {
    expect(
      pickTravelerMaterial({
        materials: [base({ id: "jm_other", jobOperationId: "op_test" })],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: []
      })
    ).toEqual({ kind: "notUsed" });
  });
});

describe("isUnitInOperationScope", () => {
  const scopes = new Map([["op_rework", new Set(["te_b"])]]);

  it("applies a rework operation only to the units sent into it", () => {
    expect(isUnitInOperationScope(scopes, "op_rework", "te_b")).toBe(true);
    expect(isUnitInOperationScope(scopes, "op_rework", "te_a")).toBe(false);
  });

  it("applies an operation with no scope rows to every unit", () => {
    expect(isUnitInOperationScope(scopes, "op_paint", "te_a")).toBe(true);
  });
});

describe("batchScanQuantity", () => {
  it("takes what the job needs from a lot that holds more", () => {
    expect(batchScanQuantity({ needed: 5, available: 1990 })).toBe(5);
  });

  it("takes the whole lot when it holds less than the job needs", () => {
    expect(batchScanQuantity({ needed: 5, available: 3 })).toBe(3);
  });

  // A quarantined lot, or one at another location, has nothing to draw.
  it("takes nothing from a lot with no stock the job can draw", () => {
    expect(batchScanQuantity({ needed: 5, available: 0 })).toBe(0);
  });
});

it("keeps an identity-only pack-out scan pending until the displayed serial is confirmed", () => {
  const stock = [{ id: "unit", readableId: " PADDED " }];
  for (const code of ["https://labels.test/x/traveler/unit", "unit"]) {
    const scan = captureIssueSerial(stock, code, true);
    expect(scan).toEqual({ observedId: "unit", confirmSerial: " PADDED " });
    stock[0]!.readableId = "NEW";
    expect(scan.confirmSerial).toBe(" PADDED ");
    stock[0]!.readableId = " PADDED ";
  }
  expect(captureIssueSerial(stock, " PADDED ", true)).toEqual({
    observedId: "unit",
    expectedSerial: " PADDED "
  });
  expect(captureIssueSerial(stock, "unit", false)).toEqual({
    observedId: "unit",
    expectedSerial: " PADDED "
  });
});

it("builds no Issue request on scanner Enter until every identity-only scan has been confirmed", () => {
  const stock = [
    { id: "unit", readableId: "unit" },
    { id: "other", readableId: " PAD " }
  ];
  const scanned = (id: string, code: string, paired = true) => ({
    id,
    ...captureIssueSerial(stock, code, paired)
  });
  const qr = scanned("unit", "https://labels.test/x/traveler/unit");
  const exact = scanned("other", " PAD ");
  expect(issueSerialChildren([exact, qr], "scan")).toBeNull();
  const url = "https://labels.test/x/traveler/unit";
  stock[0]!.readableId = url;
  expect(issueSerialChildren([scanned("unit", url)], "scan")).toBeNull();
  expect(issueSerialChildren([qr], "confirm")).toEqual([
    { trackedEntityId: "unit", expectedSerial: "unit", quantity: 1 }
  ]);
  expect(issueSerialChildren([exact], "scan")).toEqual([
    { trackedEntityId: "other", expectedSerial: " PAD ", quantity: 1 }
  ]);
  const ordinary = scanned(
    "other",
    "https://labels.test/x/traveler/other",
    false
  );
  expect(issueSerialChildren([ordinary], "scan")).toEqual([
    { trackedEntityId: "other", expectedSerial: " PAD ", quantity: 1 }
  ]);
});
