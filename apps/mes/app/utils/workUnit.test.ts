// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  initialWorkUnitState,
  operationUnits,
  pickEvent,
  serialUnitSelection,
  shownRecordIndex,
  type WorkUnitEvent,
  type WorkUnitState,
  workUnitReducer
} from "./workUnit";

type Unit = { id: string; inOperationScope?: boolean; done?: boolean };
const isOpen = (unit: Unit) => !unit.done;
/** "a!" is unit a, done here. */
const units = (...ids: string[]): Unit[] =>
  ids.map((id) => ({ id: id.replace("!", ""), done: id.endsWith("!") }));

const run = (events: WorkUnitEvent[], start = initialWorkUnitState(null)) =>
  events.reduce<WorkUnitState>(workUnitReducer, start);

const select = (
  over: Partial<Parameters<typeof serialUnitSelection<Unit>>[0]>
) =>
  serialUnitSelection<Unit>({
    serial: true,
    isFirstOperation: false,
    units: units("a", "b", "c"),
    urlUnitId: null,
    state: initialWorkUnitState(null),
    isOpen,
    ...over
  });

describe("serialUnitSelection on a later operation", () => {
  it("does not hold a unit that is only in the URL, and asks for one", () => {
    const selection = select({ urlUnitId: "b" });
    expect(selection.workUnitId).toBeUndefined();
    expect(selection.noUnitHeld).toBe(true);
    expect(selection.pickerOpen).toBe(true);
  });

  it("holds a unit scanned on its own label before the screen opened", () => {
    const selection = select({
      urlUnitId: "b",
      state: initialWorkUnitState({ unitId: "b", isOpen: true })
    });
    expect(selection.workUnitId).toBe("b");
    expect(selection.pickerOpen).toBe(false);
  });

  it("holds a picked unit at once", () => {
    const selection = select({
      state: run([{ type: "pick", unitId: "c", isOpen: true }])
    });
    expect(selection.workUnitId).toBe("c");
    expect(selection.noUnitHeld).toBe(false);
    expect(selection.pickerOpen).toBe(false);
  });

  it("asks again when the held unit is done here and several are left", () => {
    const state = run([
      { type: "close" },
      { type: "pick", unitId: "a", isOpen: true }
    ]);
    const selection = select({ units: units("a!", "b", "c"), state });
    expect(selection.workUnitId).toBeUndefined();
    expect(selection.pickerOpen).toBe(true);
  });

  it("stays closed once dismissed on the done unit", () => {
    const state = run([
      { type: "pick", unitId: "a", isOpen: true },
      { type: "close" }
    ]);
    expect(select({ units: units("a!", "b", "c"), state }).pickerOpen).toBe(
      false
    );
  });

  it("moves on to the one unit left without asking", () => {
    const state = run([{ type: "pick", unitId: "a", isOpen: true }]);
    const selection = select({ units: units("a!", "b", "c!"), state });
    expect(selection.workUnitId).toBe("b");
    expect(selection.pickerOpen).toBe(false);
  });

  it("shows a finished unit picked to look back at, but names it in no write", () => {
    const state = run([{ type: "pick", unitId: "a", isOpen: false }]);
    const selection = select({ units: units("a!", "b", "c"), state });
    expect(selection.unit?.id).toBe("a");
    expect(selection.workUnitId).toBeUndefined();
    // A quality issue or unconsume still names it.
    expect(selection.reviewUnitId).toBe("a");
    expect(selection.pickerOpen).toBe(false);
  });

  it("never holds a unit outside the operation's units", () => {
    const state = run([{ type: "pick", unitId: "z", isOpen: true }]);
    expect(select({ state }).workUnitId).toBeUndefined();
  });

  it("opens the picker when asked by hand", () => {
    const state = run([{ type: "close" }, { type: "ask" }]);
    expect(select({ state }).pickerOpen).toBe(true);
  });
});

describe("serialUnitSelection on the first operation", () => {
  it("works the URL's unit while it is open", () => {
    const selection = select({ isFirstOperation: true, urlUnitId: "b" });
    expect(selection.workUnitId).toBe("b");
    expect(selection.noUnitHeld).toBe(false);
    expect(selection.pickerOpen).toBe(false);
  });

  it("moves on to the next open unit when the URL's unit is done", () => {
    expect(
      select({
        isFirstOperation: true,
        units: units("a!", "b", "c"),
        urlUnitId: "a"
      }).workUnitId
    ).toBe("b");
  });

  it("keeps a finished unit the operator picked to look back at, writing nothing", () => {
    const selection = select({
      isFirstOperation: true,
      units: units("a!", "b", "c"),
      urlUnitId: "a",
      state: run([{ type: "pick", unitId: "a", isOpen: false }])
    });
    expect(selection.unit?.id).toBe("a");
    expect(selection.writesBlocked).toBe(true);
    expect(selection.workUnitId).toBeUndefined();
    expect(selection.reviewUnitId).toBe("a");
    expect(
      select({ isFirstOperation: true, urlUnitId: "b" }).writesBlocked
    ).toBe(false);
  });
});

describe("shownRecordIndex", () => {
  const all = units("a", "b", "c");
  const recordIndexOf = (selection: ReturnType<typeof select>) =>
    shownRecordIndex(
      selection,
      Math.max(
        all.findIndex((unit) => unit.id === selection.unit?.id),
        0
      )
    );

  it("shows no unit's records on a later operation with none held", () => {
    expect(recordIndexOf(select({ urlUnitId: "b" }))).toBeNull();
    const closed = run([{ type: "close" }]);
    expect(recordIndexOf(select({ state: closed }))).toBeNull();
  });

  it("shows the picked unit's records on a later operation", () => {
    const state = run([{ type: "pick", unitId: "c", isOpen: true }]);
    expect(recordIndexOf(select({ state }))).toBe(2);
  });

  it("shows a finished unit looked back at", () => {
    const state = run([{ type: "pick", unitId: "b", isOpen: false }]);
    expect(recordIndexOf(select({ units: units("a", "b!", "c"), state }))).toBe(
      1
    );
  });

  it("keeps the first operation's unit, and the first when it has none", () => {
    expect(
      recordIndexOf(select({ isFirstOperation: true, urlUnitId: "b" }))
    ).toBe(1);
    expect(recordIndexOf(select({ isFirstOperation: true, units: [] }))).toBe(
      0
    );
  });

  it("passes the index through for a part that is not serial", () => {
    expect(shownRecordIndex(select({ serial: false }), 3)).toBe(3);
  });
});

describe("pickEvent", () => {
  it("picks a unit the screen lists, and nothing for any other", () => {
    expect(pickEvent(units("a!", "b"), "a", isOpen)).toEqual({
      type: "pick",
      unitId: "a",
      isOpen: false
    });
    expect(pickEvent(units("a", "b"), "z", isOpen)).toBeNull();
  });
});

describe("serialUnitSelection for a part that is not serial", () => {
  it("holds nothing and never asks", () => {
    const selection = select({ serial: false, urlUnitId: "a" });
    expect(selection.unit).toBeUndefined();
    expect(selection.noUnitHeld).toBe(false);
    expect(selection.writesBlocked).toBe(false);
    expect(selection.pickerOpen).toBe(false);
  });
});

describe("operationUnits", () => {
  it("keeps the units in the operation's scope, up to its quantity", () => {
    expect(
      operationUnits(
        [
          { id: "a", inOperationScope: false },
          { id: "b" },
          { id: "c" },
          { id: "d" }
        ],
        2
      ).map((unit) => unit.id)
    ).toEqual(["b", "c"]);
  });
});

describe("serialUnitSelection with a unit on hold", () => {
  const isOnHold = (unit: Unit) => unit.id === "b";
  const pick = (unitId: string, open: boolean) =>
    run([{ type: "pick", unitId, isOpen: open }]);

  it("lists it as not open and names it in no write", () => {
    const selection = select({ isOnHold, state: pick("b", false) });
    expect(selection.openUnits.map((unit) => unit.id)).toEqual(["a", "c"]);
    expect(selection.unit?.id).toBe("b");
    expect(selection.unitIsOpen).toBe(false);
    expect(selection.writesBlocked).toBe(true);
    expect(selection.workUnitId).toBeUndefined();
    // A quality issue or an unconsume still names it.
    expect(selection.reviewUnitId).toBe("b");
  });

  it("keeps a picked unit on screen when it goes on hold, and asks for another", () => {
    // Picked while open; the issue was raised after.
    const selection = select({ isOnHold, state: pick("b", true) });
    expect(selection.unit?.id).toBe("b");
    expect(selection.writesBlocked).toBe(true);
    expect(selection.pickerOpen).toBe(true);
  });

  it("keeps it on screen even when one other unit is left", () => {
    const selection = select({
      isOnHold,
      units: units("a!", "b", "c"),
      state: pick("b", true)
    });
    expect(selection.unit?.id).toBe("b");
    expect(selection.soleOpenUnit?.id).toBe("c");
    expect(selection.workUnitId).toBeUndefined();
  });

  it("takes the other unit as the one left when none was picked", () => {
    const selection = select({ isOnHold, units: units("a!", "b", "c") });
    expect(selection.workUnitId).toBe("c");
    expect(selection.pickerOpen).toBe(false);
  });

  it("offers the units on hold to look at when only they are left", () => {
    const left = units("a!", "b", "c!");
    const selection = select({ isOnHold, units: left });
    expect(selection.unit).toBeUndefined();
    expect(selection.openUnits).toEqual([]);
    expect(selection.onHoldUnits.map((unit) => unit.id)).toEqual(["b"]);
    expect(selection.pickerOpen).toBe(true);
    expect(selection.writesBlocked).toBe(true);
    // Once one is on screen the picker stays closed: its banner says why.
    const viewed = select({ isOnHold, units: left, state: pick("b", false) });
    expect(viewed.unit?.id).toBe("b");
    expect(viewed.pickerOpen).toBe(false);
  });

  it("lists no unit on hold that is already done here", () => {
    const selection = select({ isOnHold, units: units("a", "b!", "c") });
    expect(selection.onHoldUnits).toEqual([]);
  });

  it("flows past it on the first operation", () => {
    const selection = select({
      isOnHold,
      isFirstOperation: true,
      units: units("a!", "b", "c"),
      urlUnitId: "b"
    });
    expect(selection.workUnitId).toBe("c");
  });

  it("changes nothing when no unit is on hold", () => {
    const state = pick("b", true);
    expect(select({ isOnHold: () => false, state })).toEqual(select({ state }));
  });
});
