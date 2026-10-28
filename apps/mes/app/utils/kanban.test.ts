// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isKanbanCompleteScan, kanbanCompleteTarget } from "./kanban";

const kanban = { id: "kbn_8f3k2m1q", completedBarcodeOverride: null };

describe("isKanbanCompleteScan", () => {
  it("accepts the label whatever host it was printed from", () => {
    expect(
      isKanbanCompleteScan(
        "https://erp.try.carbon.ms/api/kanban/complete/kbn_8f3k2m1q",
        kanban
      )
    ).toBe(true);
  });

  it("refuses another kanban's label", () => {
    expect(
      isKanbanCompleteScan(
        "https://erp.carbon.ms/api/kanban/complete/kbn_other01",
        kanban
      )
    ).toBe(false);
  });

  it("accepts the override and, beside it, the printed label", () => {
    const withOverride = {
      ...kanban,
      completedBarcodeOverride: "KB 0042/DONE#1"
    };
    expect(isKanbanCompleteScan("KB 0042/DONE#1", withOverride)).toBe(true);
    expect(
      isKanbanCompleteScan(
        "https://erp.carbon.ms/api/kanban/complete/kbn_8f3k2m1q",
        withOverride
      )
    ).toBe(true);
  });

  it("refuses text that is not a URL", () => {
    expect(isKanbanCompleteScan("kbn_8f3k2m1q", kanban)).toBe(false);
  });
});

describe("kanbanCompleteTarget", () => {
  const serial = { requiresSerialTracking: true };

  it("completes the unit on screen when it is still open here", () => {
    expect(
      kanbanCompleteTarget({
        ...serial,
        isFirstOperation: false,
        selectedEntityId: "te_2",
        selectedIsIncomplete: true
      })
    ).toEqual({ action: "complete", trackedEntityId: "te_2" });
  });

  it("asks for a unit at a later operation when none is held", () => {
    expect(
      kanbanCompleteTarget({
        ...serial,
        isFirstOperation: false,
        selectedEntityId: null,
        selectedIsIncomplete: false
      })
    ).toEqual({ action: "select" });
    // The unit on screen is already done here: never complete it twice.
    expect(
      kanbanCompleteTarget({
        ...serial,
        isFirstOperation: false,
        selectedEntityId: "te_1",
        selectedIsIncomplete: false
      })
    ).toEqual({ action: "select" });
  });

  it("lets the first operation take the next unit in order", () => {
    expect(
      kanbanCompleteTarget({
        ...serial,
        isFirstOperation: true,
        selectedEntityId: "te_1",
        selectedIsIncomplete: false
      })
    ).toEqual({ action: "complete" });
  });

  it("names no unit for a batch or untracked part", () => {
    expect(
      kanbanCompleteTarget({
        requiresSerialTracking: false,
        isFirstOperation: false,
        selectedEntityId: "lot_1",
        selectedIsIncomplete: true
      })
    ).toEqual({ action: "complete" });
  });
});
