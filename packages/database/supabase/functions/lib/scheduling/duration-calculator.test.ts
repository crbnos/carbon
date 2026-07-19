import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  calculateAttendedHours,
  calculateDurationHours,
} from "./duration-calculator.ts";
import type { BaseOperation } from "./types.ts";

function op(overrides: Partial<BaseOperation>): BaseOperation {
  return {
    jobId: "job-1",
    processId: "proc-1",
    ...overrides,
  };
}

Deno.test("attended hours = setup + labor, ignoring machine time", () => {
  const operation = op({
    setupTime: 30,
    setupUnit: "Total Minutes",
    laborTime: 5,
    laborUnit: "Total Minutes",
    machineTime: 20,
    machineUnit: "Total Hours",
  });
  assertEquals(calculateAttendedHours(operation), 35 / 60);
  // total is machine-bound: setup + machine
  assertEquals(calculateDurationHours(operation), 0.5 + 20);
});

Deno.test("labor >= machine: attended equals the full duration", () => {
  const operation = op({
    setupTime: 1,
    setupUnit: "Total Hours",
    laborTime: 20,
    laborUnit: "Total Hours",
    machineTime: 20,
    machineUnit: "Total Hours",
  });
  assertEquals(
    calculateAttendedHours(operation),
    calculateDurationHours(operation)
  );
  assertEquals(calculateAttendedHours(operation), 21);
});

Deno.test("zero setup and labor: attended is 0 (unattended op)", () => {
  const operation = op({
    machineTime: 8,
    machineUnit: "Total Hours",
  });
  assertEquals(calculateAttendedHours(operation), 0);
  assertEquals(calculateDurationHours(operation), 8);
});

Deno.test("attended respects per-piece units and quantity", () => {
  const operation = op({
    operationQuantity: 30,
    laborTime: 2,
    laborUnit: "Minutes/Piece",
    machineTime: 1,
    machineUnit: "Hours/Piece",
  });
  // 30 pieces x 2 min = 1h labor; machine 30h
  assertEquals(calculateAttendedHours(operation), 1);
  assertEquals(calculateDurationHours(operation), 30);
});
