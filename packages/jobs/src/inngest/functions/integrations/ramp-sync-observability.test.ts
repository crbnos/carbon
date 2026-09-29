import { describe, expect, it } from "vitest";
import {
  countRampSyncFailures,
  recordRampFamilyError
} from "./ramp-sync-observability";

describe("Ramp sync failure observability", () => {
  it("records a drain failure without erasing item-level failures", () => {
    const result: { failed: number; error?: string } = { failed: 2 };

    recordRampFamilyError(result, new Error("page two unavailable"));

    expect(result).toEqual({
      failed: 3,
      error: "page two unavailable"
    });
  });

  it("counts confirmation failures even when every item was processed", () => {
    expect(
      countRampSyncFailures([
        { failed: 0, confirmError: "confirmation unavailable" },
        { failed: 2 },
        { failed: 0 }
      ])
    ).toBe(3);
  });
});
