// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  afterItemScanRefusal,
  canChooseInDialog,
  enqueueItemScan,
  keepScansForUnit,
  type QueuedItemScan,
  queuedPieces
} from "./itemScanQueue";

const bearing: QueuedItemScan = {
  itemId: "bearing",
  parentTrackedEntityId: "SN-1",
  pieces: 2,
  closeDialog: false
};
const washer: QueuedItemScan = {
  itemId: "washer",
  parentTrackedEntityId: "SN-1",
  pieces: 1,
  closeDialog: false
};

describe("enqueueItemScan", () => {
  it("adds a new item at the end", () => {
    expect(
      enqueueItemScan([bearing], {
        itemId: "washer",
        parentTrackedEntityId: "SN-1",
        closeDialog: false
      })
    ).toEqual([bearing, washer]);
  });

  it("counts another scan of a waiting item for the same unit on its entry", () => {
    expect(
      enqueueItemScan([bearing, washer], {
        itemId: "bearing",
        parentTrackedEntityId: "SN-1",
        closeDialog: true
      })
    ).toEqual([
      {
        itemId: "bearing",
        parentTrackedEntityId: "SN-1",
        pieces: 3,
        closeDialog: true
      },
      washer
    ]);
  });

  it("keeps a scan of the same item for another unit apart", () => {
    expect(
      enqueueItemScan([bearing], {
        itemId: "bearing",
        parentTrackedEntityId: "SN-2",
        closeDialog: false
      })
    ).toEqual([
      bearing,
      {
        itemId: "bearing",
        parentTrackedEntityId: "SN-2",
        pieces: 1,
        closeDialog: false
      }
    ]);
  });
});

describe("keepScansForUnit", () => {
  it("drops the scans made for the old unit when another is held", () => {
    // Three pieces scanned for SN-1, then SN-2's label: none go into SN-2.
    expect(keepScansForUnit([bearing, washer], "SN-2")).toEqual({
      queue: [],
      dropped: 3
    });
  });

  it("drops every waiting scan when no unit is held any more", () => {
    expect(keepScansForUnit([bearing], null)).toEqual({
      queue: [],
      dropped: 2
    });
  });

  it("keeps the scans of the unit still held", () => {
    const other = { ...washer, parentTrackedEntityId: "SN-2" };
    expect(keepScansForUnit([bearing, other], "SN-1")).toEqual({
      queue: [bearing],
      dropped: 1
    });
  });
});

describe("canChooseInDialog", () => {
  it("opens the dialog on the unit the scan was made for", () => {
    expect(
      canChooseInDialog({
        unitRequired: false,
        scannedForUnitId: "SN-1",
        heldUnitId: "SN-1"
      })
    ).toBe(true);
  });

  it("never opens the dialog while no unit is held", () => {
    expect(
      canChooseInDialog({
        unitRequired: true,
        scannedForUnitId: null,
        heldUnitId: null
      })
    ).toBe(false);
  });

  it("never opens the dialog on a unit the scan was not made for", () => {
    expect(
      canChooseInDialog({
        unitRequired: false,
        scannedForUnitId: "SN-1",
        heldUnitId: "SN-2"
      })
    ).toBe(false);
  });
});

describe("afterItemScanRefusal", () => {
  it("drops the refused item's scans and keeps the others", () => {
    expect(
      afterItemScanRefusal([bearing, washer], {
        itemId: "bearing",
        needsOperator: false
      })
    ).toEqual([washer]);
  });

  it("empties the queue when the operator must choose in the dialog", () => {
    expect(
      afterItemScanRefusal([bearing, washer], {
        itemId: "other",
        needsOperator: true
      })
    ).toEqual([]);
  });
});

describe("queuedPieces", () => {
  it("adds the pieces of every waiting item", () => {
    expect(queuedPieces([bearing, washer])).toBe(3);
    expect(queuedPieces([])).toBe(0);
  });
});
