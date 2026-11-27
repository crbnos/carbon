// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

// Apply on either planning page: the gate lets in a planner with either page,
// and each action needs the page of what it changes (a job, a PO line, a
// planned order). Once a write may have committed, a later failure is an
// `errors` line in the answer, never an error that hides what was applied.

import { applyPlanningActions as applyProductionPlanningActions } from "../app/modules/production/production.server";
import { applyPlanningActions as applyPurchasingPlanningActions } from "../app/modules/purchasing/purchasing.server";
import { createServiceContext } from "@carbon/api/service-fn.server";
import { pageClaims } from "./page-claims";

type Claims = Record<
  string,
  { view: string[]; create: string[]; update: string[]; delete: string[] }
>;

const edit = { view: ["c1"], create: [], update: ["c1"], delete: [] };

/** Kysely: each table's rows, whatever the filter. A transaction fails: no
 *  write reaches a database, and the ones that try are recorded. */
function kyselyWith(rows: Record<string, unknown[]>, writes: string[]) {
  const query = (result: () => unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "selectAll",
      "where",
      "innerJoin",
      "leftJoin",
      "set",
      "returning"
    ]) {
      chain[method] = () => chain;
    }
    chain.execute = async () => result();
    return chain;
  };
  return {
    isTransaction: false,
    selectFrom: (table: string) => query(() => rows[table] ?? []),
    updateTable: (table: string) => {
      writes.push(`update ${table}`);
      return query(() => []);
    },
    transaction: () => ({
      execute: async () => {
        writes.push("transaction");
        throw new Error("connection lost");
      }
    })
  };
}

function contextFor(
  permissions: Claims,
  rows: Record<string, unknown[]>,
  writes: string[]
) {
  return createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: "u1",
      permissions: pageClaims(permissions)
    },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => ({}) as never,
    pg: () => kyselyWith(rows, writes) as never,
    kv: () => ({}) as never
  });
}

const action = (overrides: Record<string, unknown>) => ({
  status: "Open",
  plannedOrderId: null,
  jobId: null,
  purchaseOrderLineId: null,
  suggestedDate: null,
  suggestedQuantity: null,
  ...overrides
});

describe("purchasing applyPlanningActions", () => {
  const plannedOrderCancel = action({
    id: "pa1",
    type: "Cancel",
    plannedOrderId: "po1"
  });
  const lineIncrease = action({
    id: "pa2",
    type: "Increase",
    purchaseOrderLineId: "pol1",
    suggestedQuantity: 8
  });

  it("refuses a role with neither Purchase Orders nor Material Planning", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { production: edit },
      { planningAction: [plannedOrderCancel] },
      writes
    );
    const result = await applyPurchasingPlanningActions(ctx, {
      planningActionIds: ["pa1"],
      type: "apply"
    });
    expect(result.error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("refuses a planned order's action to a role with only Purchase Orders, before any write", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { "purchasing.purchaseOrders": edit },
      { planningAction: [plannedOrderCancel] },
      writes
    );
    const result = await applyPurchasingPlanningActions(ctx, {
      planningActionIds: ["pa1"],
      type: "apply"
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      success: false,
      applied: [],
      errors: [
        "Planning action pa1 changes a planned order, which needs Edit on Purchasing → Material Planning"
      ]
    });
    expect(writes).toEqual([]);
  });

  it("refuses a PO line's action to a role with only Material Planning, before any write", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { "purchasing.materialPlanning": edit },
      { planningAction: [lineIncrease] },
      writes
    );
    const result = await applyPurchasingPlanningActions(ctx, {
      planningActionIds: ["pa2"],
      type: "apply"
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      success: false,
      applied: [],
      errors: [
        "Planning action pa2 changes a purchase order line, which needs Edit on Purchase Orders"
      ]
    });
    expect(writes).toEqual([]);
  });

  it("answers a failed planned-order apply as an error line, not a refusal", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { purchasing: edit },
      { planningAction: [plannedOrderCancel] },
      writes
    );
    const result = await applyPurchasingPlanningActions(ctx, {
      planningActionIds: ["pa1"],
      type: "apply"
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      success: false,
      applied: [],
      errors: [
        "Failed to apply planning actions to planned orders: connection lost"
      ]
    });
    expect(writes).toEqual(["transaction"]);
  });
});

describe("production applyPlanningActions", () => {
  const jobDefer = action({
    id: "pa1",
    type: "Defer",
    jobId: "j1",
    suggestedDate: "2297-01-08"
  });
  const plannedOrderDefer = action({
    id: "pa2",
    type: "Defer",
    plannedOrderId: "mo1",
    suggestedDate: "2297-01-08"
  });

  it("refuses a role without Material Planning", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { "production.jobs": edit },
      { planningAction: [jobDefer] },
      writes
    );
    const result = await applyProductionPlanningActions(ctx, {
      planningActionIds: ["pa1"]
    });
    expect(result.error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("lists a job's action for a role with Material Planning but not Jobs, before any write", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { "production.materialPlanning": edit },
      { planningAction: [jobDefer, plannedOrderDefer] },
      writes
    );
    const result = await applyProductionPlanningActions(ctx, {
      planningActionIds: ["pa1"]
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      applied: [],
      errors: [
        "Planning action pa1 changes a job, which needs Edit on Jobs"
      ]
    });
    expect(writes).toEqual([]);
  });

  it("lets a role with Material Planning but not Jobs apply a planned order's action", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { "production.materialPlanning": edit },
      { planningAction: [plannedOrderDefer] },
      writes
    );
    const result = await applyProductionPlanningActions(ctx, {
      planningActionIds: ["pa2"]
    });
    expect(result.error).toBeNull();
    // not refused: the apply ran, and its transaction failed
    expect(result.data).toMatchObject({
      applied: [],
      errors: [
        "Failed to apply planning actions to planned orders: connection lost"
      ]
    });
    expect(writes).toEqual(["transaction"]);
  });

  it("answers failures after the planned orders as error lines, not a refusal", async () => {
    const writes: string[] = [];
    const ctx = contextFor(
      { production: edit },
      {
        planningAction: [jobDefer, plannedOrderDefer],
        job: [{ id: "j1", status: "Draft", quantityReceivedToInventory: 0 }]
      },
      writes
    );
    const result = await applyProductionPlanningActions(ctx, {
      planningActionIds: ["pa1", "pa2"]
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      applied: [],
      errors: [
        "Failed to apply planning actions to planned orders: connection lost",
        "Failed to reschedule jobs: connection lost"
      ]
    });
    expect(writes).toEqual(["transaction", "transaction"]);
  });
});
