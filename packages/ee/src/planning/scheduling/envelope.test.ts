import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";

/**
 * Performance-envelope proof for the finite placement engine.
 *
 * `WorkCenterSelector.selectWorkCentersForOperations` is the pure, DB-free core
 * of the scheduling run (forward-ASAP placement, topological order, allocation,
 * tie-breaks). This test brackets it around a large batch — 2,000 operations
 * across 200 jobs and 20 work centers — and asserts it finishes well inside the
 * < 10s envelope. Work centers are alwaysOn (one continuous window each) and
 * every op is sticky, so no `MasterDataProvider` (and no `initialize()`) is
 * needed: placement is exercised, not master-data reads.
 *
 * Skippable via SKIP_ENVELOPE=1 (the env read is guarded so the test file loads
 * even without --allow-env).
 */

import type { MasterDataProvider } from "./master-data-provider.ts";
import type { ResourceCapacityData } from "./slot-allocator.ts";
import { assert } from "./test-helpers.ts";
import type { JobOperationDependency, ScheduledOperation } from "./types.ts";
import {
  type FiniteSchedulingContext,
  WorkCenterSelector
} from "./work-center-selector.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

const JOB_COUNT = 200;
const OPS_PER_JOB = 10;
const WORK_CENTER_COUNT = 20;
const ENVELOPE_MS = 10_000;

function makeOperations(): ScheduledOperation[] {
  const ops: ScheduledOperation[] = [];
  for (let j = 0; j < JOB_COUNT; j++) {
    for (let k = 0; k < OPS_PER_JOB; k++) {
      const idx = j * OPS_PER_JOB + k;
      ops.push({
        id: `op-${j}-${k}`,
        jobId: `job-${j}`,
        processId: "p-ungated",
        workCenterId: `wc-${idx % WORK_CENTER_COUNT}`,
        order: k,
        setupTime: 0.25,
        setupUnit: "Total Hours",
        laborTime: 1,
        laborUnit: "Total Hours",
        machineTime: 0.5,
        machineUnit: "Total Hours",
        operationQuantity: 5,
        quantityComplete: 0,
        startDate: null,
        dueDate: null,
        priority: 99,
        durationHours: 1.25,
        durationDays: 1,
        hasConflict: false,
        conflictReason: null,
        status: "Ready"
      });
    }
  }
  return ops;
}

function makeDependencies(): JobOperationDependency[] {
  const deps: JobOperationDependency[] = [];
  for (let j = 0; j < JOB_COUNT; j++) {
    for (let k = 1; k < OPS_PER_JOB; k++) {
      deps.push({
        operationId: `op-${j}-${k}`,
        dependsOnId: `op-${j}-${k - 1}`,
        jobId: `job-${j}`
      });
    }
  }
  return deps;
}

function makeContext(): FiniteSchedulingContext {
  const now = utc("2026-01-05T00:00:00.000Z");
  const windowsEnd = utc("2027-01-05T00:00:00.000Z");
  const capacityByWorkCenter = new Map<string, ResourceCapacityData>();
  for (let w = 0; w < WORK_CENTER_COUNT; w++) {
    const id = `wc-${w}`;
    capacityByWorkCenter.set(id, {
      workCenter: { id },
      // alwaysOn / lights-out: one continuous window over the whole horizon.
      windows: [{ start: now, end: windowsEnd }],
      reservations: []
    });
  }
  return {
    capacityByWorkCenter,
    requirementByProcess: new Map(),
    employeesByAbility: new Map(),
    reservationsByEmployee: new Map(),
    dependencies: makeDependencies(),
    now,
    horizonDays: 365,
    windowsEnd,
    peopleByWorkCenter: new Map(),
    assignmentsByEmployee: new Map(),
    requiresStaffing: false,
    peopleBudgets: new Map(),
    windowsByEmployee: new Map(),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>()
  };
}

/** Read SKIP_ENVELOPE without depending on @types/node's process typings. */
function skipEnvelope(): boolean {
  try {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    return env?.SKIP_ENVELOPE === "1";
  } catch {
    return false;
  }
}

it.skipIf(skipEnvelope())(
  "places 2,000 operations within the < 10s performance envelope",
  async () => {
    const operations = makeOperations();
    const selector = new WorkCenterSelector(
      {} as unknown as MasterDataProvider,
      "loc1"
    );
    selector.setFiniteContext(makeContext());

    const startedAt = performance.now();
    const selections = await selector.selectWorkCentersForOperations(
      operations,
      { jobDueDate: null }
    );
    const elapsedMs = performance.now() - startedAt;

    console.log(
      `[envelope] placed ${selections.size} operations across ${WORK_CENTER_COUNT} work centers in ${elapsedMs.toFixed(1)}ms`
    );

    assert(
      selections.size === operations.length,
      `expected ${operations.length} selections, got ${selections.size}`
    );
    assert(
      elapsedMs < ENVELOPE_MS,
      `placement took ${elapsedMs.toFixed(1)}ms, exceeding the ${ENVELOPE_MS}ms envelope`
    );
  }
);
