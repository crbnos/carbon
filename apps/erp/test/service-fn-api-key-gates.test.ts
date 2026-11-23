// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import {
  createTimesheetCorrection,
  logTimesheetEntry,
  saveTimesheetEntry
} from "../app/modules/projects/projects.server";
import {
  deleteContractFunding,
  upsertContractFunding
} from "../app/modules/sales/sales.server";
import { setServiceJobDayHours } from "../app/modules/service/service.server";

// These run with no database: a refusal at the gate never reaches a client, and
// a call past the gate fails on the empty clients with another category.

const COMPANY = "company-1";
const noScope: Record<"view" | "create" | "update" | "delete", string[]> = {
  view: [],
  create: [],
  update: [],
  delete: []
};

const key = (
  scopes: Record<string, Partial<typeof noScope>>
): Extract<Actor, { type: "apiKey" }> => ({
  type: "apiKey",
  createdBy: "user-1",
  scopes: Object.fromEntries(
    Object.entries(scopes).map(([module, actions]) => [
      module,
      { ...noScope, ...actions }
    ])
  )
});

const contextOf = (actor: Actor) =>
  createServiceContext({
    actor,
    company: { id: COMPANY, groupId: "group-1" },
    caller: {} as never,
    system: () => ({}) as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

const salesViewKey = key({ sales: { view: [COMPANY] } });

const logTime = {
  projectId: "p",
  projectElementId: "e",
  laborCategoryId: "l",
  entryDate: "2026-11-02",
  hours: 1
};
const saveTime = {
  ...logTime,
  workLocationId: "w",
  rdActivityRole: ""
};
const correction = {
  timesheetEntryId: "t",
  hours: 1,
  correctionReason: "Wrong hours"
};
const dayHours = { serviceJobId: "j", entryDate: "2026-11-02", hours: 1 };

describe("time operations gated on company membership", () => {
  it.each([
    ["logTimesheetEntry", () => logTimesheetEntry, logTime],
    ["saveTimesheetEntry", () => saveTimesheetEntry, saveTime],
    ["createTimesheetCorrection", () => createTimesheetCorrection, correction],
    ["setServiceJobDayHours", () => setServiceJobDayHours, dayHours]
  ] as const)("%s refuses a read-only API key", async (_name, op, input) => {
    const { error } = await (op() as never as (
      ctx: unknown,
      input: unknown
    ) => Promise<{ error: { category: string } | null }>)(
      contextOf(salesViewKey),
      input
    );
    expect(error?.category).toBe("forbidden");
  });

  it("lets a key with the module's update scope past the refusal", async () => {
    const { error } = await setServiceJobDayHours(
      contextOf(key({ service: { update: [COMPANY] } })),
      dayHours
    );
    expect(error?.category).not.toBe("forbidden");
  });
});

describe("contract funding actions", () => {
  it("refuses a delete to a caller with update but not delete", async () => {
    const { error } = await deleteContractFunding(
      contextOf(key({ sales: { view: [COMPANY], update: [COMPANY] } })),
      { id: "funding-1" }
    );
    expect(error?.category).toBe("forbidden");
  });

  it("refuses a save to a caller with only view", async () => {
    const { error } = await upsertContractFunding(contextOf(salesViewKey), {
      customerContractLineId: "line-1",
      modificationNumber: "P00001",
      fundedDate: "2026-11-02",
      acrn: "AA",
      fundedCost: 100,
      fundedFee: 0
    } as never);
    expect(error?.category).toBe("forbidden");
  });
});
