import { describe, expect, it } from "vitest";
// Import the logic module directly — the ERP barrels drag lingui macros vitest
// does not transform (see batching-migration-guards.test.ts).
import {
  getDefaultSerialCompleteQuantity,
  getReceivableSerialUnits,
  isFractionalSerialQuantity,
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

  it("returns null when nothing can be received", () => {
    expect(getReceivableSerialUnits([])).toBeNull();
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001", status: "Consumed" })
      ])
    ).toBeNull();
  });
});

describe("getDefaultSerialCompleteQuantity", () => {
  it("defaults to the units finished on the shop floor", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        availableQuantity: 1,
        jobQuantity: 3,
        receivableSerialCount: 3
      })
    ).toBe(1);
  });

  it("defaults to the job quantity when nothing was finished on the shop floor", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        availableQuantity: 0,
        jobQuantity: 3,
        receivableSerialCount: 3
      })
    ).toBe(3);
  });

  it("never defaults above the units that can be received", () => {
    expect(
      getDefaultSerialCompleteQuantity({
        availableQuantity: 0,
        jobQuantity: 5,
        receivableSerialCount: 2
      })
    ).toBe(2);
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
