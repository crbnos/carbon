// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));
vi.mock("@carbon/env", () => ({
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/server-functions", () => ({
  serverFns: { system: () => ({}), as: () => ({}) }
}));
vi.mock("~/modules/inventory/inventory.service", () => ({
  cancelOpenPickingListsForJob: vi.fn()
}));
// production.models reaches the module barrels (and through them a Supabase
// client built at import); cancelJob needs nothing from it.
vi.mock("./production.models", () => ({
  isJobLocked: vi.fn(() => false)
}));
vi.mock("./production.service", () => ({
  getJobReleaseReadiness: vi.fn(),
  recalculateJobRequirements: vi.fn(),
  returnPickedRemaindersForJob: vi.fn(),
  runMRP: vi.fn(),
  updateJobStatus: vi.fn()
}));

import { cancelOpenPickingListsForJob } from "~/modules/inventory/inventory.service";
import { cancelJob } from "./production.server";
import {
  returnPickedRemaindersForJob,
  updateJobStatus
} from "./production.service";

// cancelJob is the one cancel path (the job status route and planning's
// Cancel action both call it). Its contract is the ORDER of its three steps
// and that it stops at the first failure, before the status changes.
describe("cancelJob", () => {
  const events: string[] = [];
  const args = {
    client: {} as never,
    db: {} as never,
    jobId: "job-1",
    companyId: "company-1",
    userId: "user-1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    vi.mocked(returnPickedRemaindersForJob).mockImplementation((async () => {
      events.push("returnPickedRemainders");
      return { error: null };
    }) as never);
    vi.mocked(cancelOpenPickingListsForJob).mockImplementation((async () => {
      events.push("cancelOpenPickingLists");
      return { error: null };
    }) as never);
    vi.mocked(updateJobStatus).mockImplementation((async () => {
      events.push("updateJobStatus");
      return { data: null, error: null };
    }) as never);
  });

  it("returns picked material, then cancels the picking lists, then sets Cancelled", async () => {
    await expect(cancelJob(args)).resolves.toBeNull();

    expect(events).toEqual([
      "returnPickedRemainders",
      "cancelOpenPickingLists",
      "updateJobStatus"
    ]);
    expect(returnPickedRemaindersForJob).toHaveBeenCalledWith(
      expect.anything(),
      args.db,
      { jobId: "job-1", userId: "user-1", companyId: "company-1" }
    );
    expect(cancelOpenPickingListsForJob).toHaveBeenCalledWith(args.db, {
      jobId: "job-1",
      companyId: "company-1",
      userId: "user-1"
    });
    expect(updateJobStatus).toHaveBeenCalledWith(args.client, {
      id: "job-1",
      companyId: "company-1",
      status: "Cancelled",
      assignee: null,
      updatedBy: "user-1"
    });
  });

  it("stops before the picking lists when returning material fails", async () => {
    vi.mocked(returnPickedRemaindersForJob).mockResolvedValueOnce({
      error: new Error("sweep failed")
    } as never);

    const failed = await cancelJob(args);

    expect(failed?.message).toBe(
      "Cancel aborted: returning picked material failed"
    );
    expect(cancelOpenPickingListsForJob).not.toHaveBeenCalled();
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("stops before the status when the picking lists cannot be closed", async () => {
    vi.mocked(cancelOpenPickingListsForJob).mockResolvedValueOnce({
      error: new Error("lists failed")
    } as never);

    const failed = await cancelJob(args);

    expect(failed?.message).toBe(
      "Cancel aborted: its picking lists could not be closed"
    );
    expect(returnPickedRemaindersForJob).toHaveBeenCalledOnce();
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("reports a failed status update", async () => {
    vi.mocked(updateJobStatus).mockImplementationOnce((async () => {
      events.push("updateJobStatus");
      return { data: null, error: new Error("update failed") };
    }) as never);

    const failed = await cancelJob(args);

    expect(failed?.message).toBe("Failed to update job status");
    expect(events).toEqual([
      "returnPickedRemainders",
      "cancelOpenPickingLists",
      "updateJobStatus"
    ]);
  });
});
