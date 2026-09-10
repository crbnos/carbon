import { it } from "vitest";
import {
  calculateAttendedHours,
  calculateDurationHours,
  remainingFractions
} from "./duration-calculator.ts";
import { assertEquals } from "./test-helpers.ts";
import type { BaseOperation } from "./types.ts";

function op(overrides: Partial<BaseOperation>): BaseOperation {
  return {
    jobId: "job-1",
    processId: "proc-1",
    ...overrides
  };
}

it("attended hours = setup + labor, ignoring machine time", () => {
  const operation = op({
    setupTime: 30,
    setupUnit: "Total Minutes",
    laborTime: 5,
    laborUnit: "Total Minutes",
    machineTime: 20,
    machineUnit: "Total Hours"
  });
  assertEquals(calculateAttendedHours(operation), 35 / 60);
  // total is machine-bound: setup + machine
  assertEquals(calculateDurationHours(operation), 0.5 + 20);
});

it("labor >= machine: attended equals the full duration", () => {
  const operation = op({
    setupTime: 1,
    setupUnit: "Total Hours",
    laborTime: 20,
    laborUnit: "Total Hours",
    machineTime: 20,
    machineUnit: "Total Hours"
  });
  assertEquals(
    calculateAttendedHours(operation),
    calculateDurationHours(operation)
  );
  assertEquals(calculateAttendedHours(operation), 21);
});

it("zero setup and labor: attended is 0 (unattended op)", () => {
  const operation = op({
    machineTime: 8,
    machineUnit: "Total Hours"
  });
  assertEquals(calculateAttendedHours(operation), 0);
  assertEquals(calculateDurationHours(operation), 8);
});

it("attended respects per-piece units and quantity", () => {
  const operation = op({
    operationQuantity: 30,
    laborTime: 2,
    laborUnit: "Minutes/Piece",
    machineTime: 1,
    machineUnit: "Hours/Piece"
  });
  // 30 pieces x 2 min = 1h labor; machine 30h
  assertEquals(calculateAttendedHours(operation), 1);
  assertEquals(calculateDurationHours(operation), 30);
});

// --- remaining-work netting -------------------------------------------------

it("remainingFractions: not started (0% complete, no event) = full work + full setup", () => {
  assertEquals(
    remainingFractions({ operationQuantity: 10, quantityComplete: 0 }, false),
    { setup: 1, work: 1 }
  );
});

it("remainingFractions: 50% complete with a production event nets half the work, no setup", () => {
  assertEquals(
    remainingFractions({ operationQuantity: 10, quantityComplete: 5 }, true),
    { setup: 0, work: 0.5 }
  );
});

it("remainingFractions: fully complete (100%) with an event = no work, no setup", () => {
  assertEquals(
    remainingFractions({ operationQuantity: 10, quantityComplete: 10 }, true),
    { setup: 0, work: 0 }
  );
});

it("remainingFractions: started but 0% done keeps full work, drops setup", () => {
  // A production event exists (setup done) but no quantity is complete yet.
  assertEquals(
    remainingFractions({ operationQuantity: 10, quantityComplete: 0 }, true),
    { setup: 0, work: 1 }
  );
});

it("remainingFractions: over-complete clamps work to 0, not negative", () => {
  assertEquals(
    remainingFractions({ operationQuantity: 10, quantityComplete: 12 }, true),
    { setup: 0, work: 0 }
  );
});

it("remainingFractions: null quantities default to full work", () => {
  assertEquals(
    remainingFractions(
      { operationQuantity: null, quantityComplete: null },
      false
    ),
    { setup: 1, work: 1 }
  );
  // null operationQuantity → treated as 1; 1 complete of 1 = done
  assertEquals(
    remainingFractions({ operationQuantity: null, quantityComplete: 1 }, true),
    { setup: 0, work: 0 }
  );
});
