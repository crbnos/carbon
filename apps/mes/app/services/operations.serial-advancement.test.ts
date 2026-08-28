import { describe, expect, it } from "vitest";
import { shouldAdvanceToNextSerialUnit } from "./serial-advancement";

describe("shouldAdvanceToNextSerialUnit (first operation)", () => {
  it("advances on arrival when nothing is selected", () => {
    expect(
      shouldAdvanceToNextSerialUnit({
        selectedEntityId: null,
        selectedIsIncomplete: false,
        heldEntityId: null
      })
    ).toBe(true);
  });

  it("stays on a selected incomplete unit", () => {
    expect(
      shouldAdvanceToNextSerialUnit({
        selectedEntityId: "SN-5",
        selectedIsIncomplete: true,
        heldEntityId: "SN-5"
      })
    ).toBe(false);
  });

  it("advances when the held unit completes", () => {
    expect(
      shouldAdvanceToNextSerialUnit({
        selectedEntityId: "SN-5",
        selectedIsIncomplete: false,
        heldEntityId: "SN-5"
      })
    ).toBe(true);
  });

  it("does not override an explicit selection of a completed unit", () => {
    // The operator went back to SN-2 (already complete) while holding SN-5 —
    // the regression: this used to snap back to the next incomplete unit.
    expect(
      shouldAdvanceToNextSerialUnit({
        selectedEntityId: "SN-2",
        selectedIsIncomplete: false,
        heldEntityId: "SN-5"
      })
    ).toBe(false);
  });

  it("keeps a completed selection stable across revalidations", () => {
    // After the explicit selection the held unit is cleared; realtime
    // revalidations re-run the decision and must not start advancing.
    expect(
      shouldAdvanceToNextSerialUnit({
        selectedEntityId: "SN-2",
        selectedIsIncomplete: false,
        heldEntityId: null
      })
    ).toBe(false);
  });
});
