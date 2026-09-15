import { describe, expect, it } from "vitest";
// Import the logic module directly — the ERP barrels drag lingui macros vitest
// does not transform (see batching-migration-guards.test.ts).
import {
  checkReceiptsBeforeComplete,
  getDefaultSerialCompleteQuantity,
  getFinishedUnreceivedQuantity,
  getReceivableSerialUnits,
  getSerialsToReceive,
  hasUnsplitSerialPlaceholder,
  isFractionalSerialQuantity,
  type JobReceiptSnapshot,
  type JobSerialUnit
} from "../app/modules/production/ui/Jobs/job-complete-logic";

const unit = (overrides: Partial<JobSerialUnit>): JobSerialUnit => ({
  id: overrides.readableId ?? "unit",
  status: "Reserved",
  quantity: 1,
  readableId: null,
  createdAt: "2026-09-14T09:00:00.000Z",
  ...overrides
});

describe("getReceivableSerialUnits", () => {
  it("lists numbered units by serial number", () => {
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0003" }),
        unit({ readableId: "SN-0001" }),
        unit({ readableId: "SN-0002" })
      ])
    ).toEqual(["SN-0001", "SN-0002", "SN-0003"]);
  });

  it("puts units finished on the shop floor first", () => {
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001" }),
        unit({ readableId: "SN-0002" }),
        unit({ readableId: "SN-0003", status: "Available" })
      ])
    ).toEqual(["SN-0003", "SN-0001", "SN-0002"]);
  });

  it("never offers consumed, rejected or scrapped units", () => {
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001", status: "Consumed" }),
        unit({ readableId: "SN-0002", status: "Rejected" }),
        unit({ readableId: "SN-0003", status: "Scrapped" }),
        unit({ readableId: "SN-0004" })
      ])
    ).toEqual(["SN-0004"]);
  });

  it("never offers units the job already received", () => {
    expect(
      getReceivableSerialUnits(
        [
          unit({ readableId: "SN-0001", status: "Available" }),
          unit({ readableId: "SN-0002", status: "Available" }),
          unit({ readableId: "SN-0003" })
        ],
        new Set(["SN-0001", "SN-0002"])
      )
    ).toEqual(["SN-0003"]);
  });

  it("keeps the quantity locked when a unit has no serial number yet", () => {
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001" }),
        unit({ readableId: null })
      ])
    ).toBeNull();
  });

  it("keeps the quantity locked for an unsplit placeholder", () => {
    expect(
      getReceivableSerialUnits([unit({ readableId: "SN-0001", quantity: 3 })])
    ).toBeNull();
  });

  it("returns null when nothing is left to receive", () => {
    expect(getReceivableSerialUnits([])).toBeNull();
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001", status: "Consumed" })
      ])
    ).toBeNull();
    expect(
      getReceivableSerialUnits(
        [unit({ readableId: "SN-0001", status: "Available" })],
        new Set(["SN-0001"])
      )
    ).toBeNull();
  });
});

describe("hasUnsplitSerialPlaceholder", () => {
  it("detects a placeholder holding several units", () => {
    expect(hasUnsplitSerialPlaceholder([unit({ quantity: 3 })])).toBe(true);
  });

  it("ignores single units, numbered or not", () => {
    expect(
      hasUnsplitSerialPlaceholder([
        unit({ readableId: "SN-0001" }),
        unit({ id: "unnumbered" })
      ])
    ).toBe(false);
  });

  it("ignores placeholders that can no longer be received", () => {
    expect(
      hasUnsplitSerialPlaceholder(
        [
          unit({ id: "scrapped", quantity: 2, status: "Scrapped" }),
          unit({ id: "received", quantity: 2, status: "Available" })
        ],
        new Set(["received"])
      )
    ).toBe(false);
  });
});

describe("getFinishedUnreceivedQuantity", () => {
  it("counts units finished on the shop floor that were not received", () => {
    expect(
      getFinishedUnreceivedQuantity(
        [
          unit({ readableId: "SN-0001", status: "Available" }),
          unit({ readableId: "SN-0002", status: "Available" }),
          unit({ readableId: "SN-0003" })
        ],
        new Set(["SN-0001"])
      )
    ).toBe(1);
  });
});

describe("getDefaultSerialCompleteQuantity", () => {
  it("defaults to the units finished on the shop floor", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        finishedUnreceivedQuantity: 1,
        jobQuantity: 3,
        priorReceivedQuantity: 0,
        receivableSerialCount: 3
      })
    ).toBe(1);
  });

  it("defaults to the job quantity when nothing was finished on the shop floor", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        finishedUnreceivedQuantity: 0,
        jobQuantity: 3,
        priorReceivedQuantity: 0,
        receivableSerialCount: 3
      })
    ).toBe(3);
  });

  it("never defaults above the units that can be received", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        finishedUnreceivedQuantity: 0,
        jobQuantity: 5,
        priorReceivedQuantity: 0,
        receivableSerialCount: 2
      })
    ).toBe(2);
  });

  it("adds new units on top of what a partial completion already received", () => {
    // 2 of 3 received earlier; the dialog must offer the cumulative 3, not 2,
    // or the database computes a delta of 0 and the third unit is never received.
    expect(
      getDefaultSerialCompleteQuantity({
        finishedUnreceivedQuantity: 0,
        jobQuantity: 3,
        priorReceivedQuantity: 2,
        receivableSerialCount: 1
      })
    ).toBe(3);
  });

  it("adds newly finished units on top of what was already received", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        finishedUnreceivedQuantity: 1,
        jobQuantity: 4,
        priorReceivedQuantity: 2,
        receivableSerialCount: 2
      })
    ).toBe(3);
  });
});

describe("getSerialsToReceive", () => {
  const receivable = ["SN-0003", "SN-0004"];

  it("previews only the units this completion adds", () => {
    expect(getSerialsToReceive(receivable, 3, 2)).toEqual(["SN-0003"]);
    expect(getSerialsToReceive(receivable, 4, 2)).toEqual([
      "SN-0003",
      "SN-0004"
    ]);
  });

  it("previews nothing when the quantity adds no units", () => {
    expect(getSerialsToReceive(receivable, 2, 2)).toEqual([]);
    expect(getSerialsToReceive(receivable, 1, 2)).toEqual([]);
  });
});

describe("isFractionalSerialQuantity", () => {
  it("flags a fraction on a serial job", () => {
    expect(isFractionalSerialQuantity(["SN-0001"], 0.5)).toBe(true);
    expect(isFractionalSerialQuantity(["SN-0001", "SN-0002"], 1.5)).toBe(true);
  });

  it("accepts whole units on a serial job", () => {
    expect(isFractionalSerialQuantity(["SN-0001"], 1)).toBe(false);
    expect(isFractionalSerialQuantity(["SN-0001"], 0)).toBe(false);
  });

  it("ignores jobs whose quantity is not chosen per serial unit", () => {
    expect(isFractionalSerialQuantity(null, 1.5)).toBe(false);
  });

  it("ignores an emptied input", () => {
    expect(isFractionalSerialQuantity(["SN-0001"], Number.NaN)).toBe(false);
  });
});

describe("checkReceiptsBeforeComplete", () => {
  const shown: JobReceiptSnapshot = {
    quantityReceivedToInventory: 2,
    trackedEntityIds: ["te-1", "te-2"]
  };

  it("submits when the receipts are unchanged", () => {
    expect(
      checkReceiptsBeforeComplete(shown, {
        quantityReceivedToInventory: 2,
        trackedEntityIds: ["te-2", "te-1"]
      })
    ).toBe("submit");
  });

  it("asks for review when another completion received more", () => {
    expect(
      checkReceiptsBeforeComplete(shown, {
        quantityReceivedToInventory: 3,
        trackedEntityIds: ["te-1", "te-2", "te-3"]
      })
    ).toBe("review");
  });

  it("asks for review when different units were received", () => {
    expect(
      checkReceiptsBeforeComplete(shown, {
        quantityReceivedToInventory: 2,
        trackedEntityIds: ["te-1", "te-3"]
      })
    ).toBe("review");
  });

  it("asks for review when the dialog shows no receipts", () => {
    expect(checkReceiptsBeforeComplete(null, shown)).toBe("review");
  });

  it("reports unreadable receipts instead of submitting", () => {
    expect(checkReceiptsBeforeComplete(shown, null)).toBe("unreadable");
  });
});
