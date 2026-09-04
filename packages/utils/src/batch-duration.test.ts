import { describe, expect, it } from "vitest";
import { batchDuration } from "./batch-duration";

describe("batchDuration", () => {
  // The spec's worked example: effective member runs of 40/70/50 minutes
  // (labor-driven; machine time 0 or lower) and a 10-minute setup on every
  // member, counted once as the shared batch setup.
  const members = [
    {
      setupDuration: 10 * 60,
      laborDuration: 40 * 60,
      machineDuration: 0,
      operationQuantity: 5,
      quantityComplete: 0
    },
    {
      setupDuration: 10 * 60,
      laborDuration: 70 * 60,
      machineDuration: 30 * 60,
      operationQuantity: 20,
      quantityComplete: 0
    },
    {
      setupDuration: 10 * 60,
      laborDuration: 50 * 60,
      machineDuration: 0,
      operationQuantity: 10,
      quantityComplete: 0
    }
  ];

  it("Simultaneous: one shared setup plus the longest member run (80 minutes)", () => {
    // 10 min setup + max(40, 70, 50) min run.
    expect(batchDuration(members, "Simultaneous")).toBe(80 * 60);
  });

  it("Sequential: one shared setup plus the sum of member runs (170 minutes)", () => {
    // 10 min setup + (40 + 70 + 50) min run.
    expect(batchDuration(members, "Sequential")).toBe(170 * 60);
  });

  it("nets a member's run by its remaining fraction (50% complete contributes half)", () => {
    const total = batchDuration(
      [
        {
          setupDuration: 0,
          laborDuration: 40 * 60,
          machineDuration: 0,
          operationQuantity: 10,
          quantityComplete: 5
        }
      ],
      "Sequential"
    );
    expect(total).toBe(20 * 60);
  });

  it("zeroes the shared setup once the batch has recorded any production event", () => {
    expect(batchDuration(members, "Simultaneous", { hasAnyEvent: true })).toBe(
      70 * 60
    );
    expect(batchDuration(members, "Sequential", { hasAnyEvent: true })).toBe(
      160 * 60
    );
  });

  it("returns 0 for an empty batch", () => {
    expect(batchDuration([], "Sequential")).toBe(0);
    expect(batchDuration([], "Simultaneous")).toBe(0);
  });

  it("treats operationQuantity <= 0 as fully remaining (full run)", () => {
    const total = batchDuration(
      [
        {
          setupDuration: 0,
          laborDuration: 40 * 60,
          machineDuration: 0,
          operationQuantity: 0,
          quantityComplete: 3
        }
      ],
      "Sequential"
    );
    expect(total).toBe(40 * 60);
  });

  it("uses machine time when machineDuration exceeds laborDuration", () => {
    const total = batchDuration(
      [
        {
          setupDuration: 0,
          laborDuration: 10 * 60,
          machineDuration: 25 * 60,
          operationQuantity: 5,
          quantityComplete: 0
        }
      ],
      "Simultaneous"
    );
    expect(total).toBe(25 * 60);
  });

  it("clamps an over-complete member to zero remaining run", () => {
    const total = batchDuration(
      [
        {
          setupDuration: 5 * 60,
          laborDuration: 40 * 60,
          machineDuration: 0,
          operationQuantity: 10,
          quantityComplete: 12
        }
      ],
      "Sequential"
    );
    expect(total).toBe(5 * 60);
  });
});
