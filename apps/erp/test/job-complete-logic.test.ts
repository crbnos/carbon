// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getDefaultSerialCompleteQuantity,
  getFinishedUnreceivedQuantity,
  getReceivableSerialUnits,
  getSerialCompleteChoice,
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
        new Set(["SN-0001"])
      )
    ).toEqual(["SN-0002", "SN-0003"]);
  });

  it("keeps the quantity locked when a unit has no serial number yet", () => {
    expect(
      getReceivableSerialUnits([
        unit({ readableId: "SN-0001" }),
        unit({ readableId: null })
      ])
    ).toBeNull();
  });

  it("keeps the quantity locked for an unsplit seed entity", () => {
    expect(
      getReceivableSerialUnits([unit({ readableId: "SN-0001", quantity: 3 })])
    ).toBeNull();
  });

  it("returns null when nothing is left to receive", () => {
    expect(
      getReceivableSerialUnits([unit({ readableId: "SN-0001", status: "Consumed" })])
    ).toBeNull();
    expect(
      getReceivableSerialUnits(
        [unit({ readableId: "SN-0001", status: "Available" })],
        new Set(["SN-0001"])
      )
    ).toBeNull();
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
        jobQuantity: 3,
        priorReceivedQuantity: 2,
        receivableSerialCount: 1
      })
    ).toBe(3);
  });
});

describe("getSerialCompleteChoice", () => {
  const seed = unit({ id: "seed", quantity: 3 });
  const none = new Set<string>();

  it("lists the serials when every unit left is numbered, with or without a sequence", () => {
    const units = [unit({ readableId: "SN-0001" }), unit({ readableId: "SN-0002" })];
    for (const hasSerialSequence of [false, true]) {
      expect(
        getSerialCompleteChoice({
          trackedEntities: units,
          receivedEntityIds: none,
          hasSerialSequence,
          jobQuantity: 2
        })
      ).toEqual({ mode: "serials", serials: ["SN-0001", "SN-0002"] });
    }
  });

  it("stays locked for an unsplit seed when the item has no serial sequence", () => {
    expect(
      getSerialCompleteChoice({
        trackedEntities: [seed],
        receivedEntityIds: none,
        hasSerialSequence: false,
        jobQuantity: 3
      })
    ).toEqual({ mode: "locked" });
  });

  it("unlocks an unsplit seed when the item has a serial sequence", () => {
    expect(
      getSerialCompleteChoice({
        trackedEntities: [seed],
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 3 });
  });

  it("counts numbered and unnumbered units left to receive, not received or scrapped ones", () => {
    const units = [
      unit({ id: "done", status: "Available", readableId: "SN-0001" }),
      unit({ id: "blank", status: "Reserved" }),
      unit({ id: "received", status: "Available", readableId: "SN-0002" }),
      unit({ id: "scrapped", status: "Scrapped" }),
      unit({ id: "issued", status: "Consumed", readableId: "SN-0003" })
    ];
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: new Set(["received"]),
        hasSerialSequence: true,
        jobQuantity: 4
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 2 });
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: new Set(["received"]),
        hasSerialSequence: false,
        jobQuantity: 4
      })
    ).toEqual({ mode: "locked" });
  });

  it("stays locked when the receipts could not be read", () => {
    expect(
      getSerialCompleteChoice({
        trackedEntities: [seed],
        receivedEntityIds: null,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "locked" });
  });

  it("stays locked when nothing is left to receive", () => {
    expect(
      getSerialCompleteChoice({
        trackedEntities: [unit({ id: "received", status: "Available" })],
        receivedEntityIds: new Set(["received"]),
        hasSerialSequence: true,
        jobQuantity: 1
      })
    ).toEqual({ mode: "locked" });
  });

  it("counts the units no row holds yet after the shop floor worked the seed", () => {
    // The first completion left the seed holding one unit and spawned one more.
    const units = [
      unit({ id: "done", status: "Available", readableId: "SN-0001" }),
      unit({ id: "spawned", status: "Reserved" })
    ];
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 3 });
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: false,
        jobQuantity: 3
      })
    ).toEqual({ mode: "locked" });
  });

  it("does not list the serials while units are still missing", () => {
    const units = [
      unit({ id: "done", status: "Available", readableId: "SN-0001" }),
      unit({ id: "started", status: "Reserved", readableId: "SN-0002" })
    ];
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 3 });
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: false,
        jobQuantity: 3
      })
    ).toEqual({ mode: "serials", serials: ["SN-0001", "SN-0002"] });
  });

  it("still owes a scrapped unit", () => {
    const units = [
      unit({ id: "scrapped", status: "Scrapped", readableId: "SN-0001" }),
      unit({ id: "replacement", status: "Reserved" })
    ];
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 3 });
  });

  it("numbers on receipt a seed left by a timing that changed back to job creation", () => {
    // Created under a deferred timing, the job still holds its unsplit seed
    // after the item switched to jobCreation: only the receipt can number it.
    expect(
      getSerialCompleteChoice({
        trackedEntities: [seed],
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "numberOnReceipt", receivableCount: 3 });
  });

  it("lists the serials of a released job whose units were numbered at release", () => {
    const units = [
      unit({ id: "a", readableId: "SN-0001" }),
      unit({ id: "b", readableId: "SN-0002" }),
      unit({ id: "c", readableId: "SN-0003" })
    ];
    expect(
      getSerialCompleteChoice({
        trackedEntities: units,
        receivedEntityIds: none,
        hasSerialSequence: true,
        jobQuantity: 3
      })
    ).toEqual({ mode: "serials", serials: ["SN-0001", "SN-0002", "SN-0003"] });
  });
});
