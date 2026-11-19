// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  afterItemScanRefusal,
  enqueueItemScan,
  type QueuedItemScan,
  queuedPieces
} from "./itemScanQueue";

const bearing: QueuedItemScan = {
  itemId: "bearing",
  pieces: 2,
  closeDialog: false
};
const washer: QueuedItemScan = {
  itemId: "washer",
  pieces: 1,
  closeDialog: false
};

describe("enqueueItemScan", () => {
  it("adds a new item at the end", () => {
    expect(
      enqueueItemScan([bearing], { itemId: "washer", closeDialog: false })
    ).toEqual([bearing, washer]);
  });

  it("counts another scan of a waiting item on its entry", () => {
    expect(
      enqueueItemScan([bearing, washer], {
        itemId: "bearing",
        closeDialog: true
      })
    ).toEqual([{ itemId: "bearing", pieces: 3, closeDialog: true }, washer]);
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
