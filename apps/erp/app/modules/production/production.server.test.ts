// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./production.models", async () => {
  const { z } = await import("zod");
  return {
    isJobLocked: vi.fn(() => false),
    jobStatus: ["Draft", "Planned", "Ready", "Cancelled"],
    scheduleOperationReorderValidator: z.object({})
  };
});
vi.mock("./production.service", () => ({
  getJobReleaseReadiness: vi.fn(),
  recalculateJobRequirements: vi.fn(),
  returnPickedRemaindersForJob: vi.fn(),
  runMRP: vi.fn(),
  updateJobStatus: vi.fn()
}));

import { cancelOpenPickingListsForJob } from "~/modules/inventory/inventory.service";
import { createServiceContext } from "~/modules/service-fn.server";
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
  const db = {} as never;
  const contextFor = (client: never) =>
    createServiceContext({
      actor: {
        type: "user",
        userId: "user-1",
        permissions: {
          production: {
            view: [],
            create: [],
            update: ["company-1"],
            delete: []
          }
        }
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: client,
      system: () => ({}) as never,
      pg: () => db,
      kv: () => ({}) as never
    });
  const client = {} as never;
  const ctx = contextFor(client);
  const input = { jobId: "job-1" };

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
      return { data: null, error: null, updated: true };
    }) as never);
  });

  it("returns picked material, then cancels the picking lists, then sets Cancelled", async () => {
    await expect(cancelJob(ctx, input)).resolves.toEqual({
      data: { jobId: "job-1" },
      error: null
    });

    expect(events).toEqual([
      "returnPickedRemainders",
      "cancelOpenPickingLists",
      "updateJobStatus"
    ]);
    expect(returnPickedRemaindersForJob).toHaveBeenCalledWith(
      expect.anything(),
      db,
      { jobId: "job-1", userId: "user-1", companyId: "company-1" }
    );
    expect(cancelOpenPickingListsForJob).toHaveBeenCalledWith(db, {
      jobId: "job-1",
      companyId: "company-1",
      userId: "user-1"
    });
    expect(updateJobStatus).toHaveBeenCalledWith(client, {
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

    const { error } = await cancelJob(ctx, input);

    expect(error?.message).toBe(
      "Cancel aborted: returning picked material failed"
    );
    expect(cancelOpenPickingListsForJob).not.toHaveBeenCalled();
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("stops before the status when the picking lists cannot be closed", async () => {
    vi.mocked(cancelOpenPickingListsForJob).mockResolvedValueOnce({
      error: new Error("lists failed")
    } as never);

    const { error } = await cancelJob(ctx, input);

    expect(error?.message).toBe(
      "Cancel aborted: its picking lists could not be closed"
    );
    expect(returnPickedRemaindersForJob).toHaveBeenCalledOnce();
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it("reports a failed status update", async () => {
    vi.mocked(updateJobStatus).mockImplementationOnce((async () => {
      events.push("updateJobStatus");
      return { data: null, error: new Error("update failed"), updated: false };
    }) as never);

    const { error } = await cancelJob(ctx, input);

    expect(error?.message).toBe("Failed to update job status");
    expect(events).toEqual([
      "returnPickedRemainders",
      "cancelOpenPickingLists",
      "updateJobStatus"
    ]);
  });

  // Planning's Cancel read the status earlier. A job released since must not
  // have its picks returned: cancelJob checks the status before anything else.
  describe("with fromStatuses", () => {
    const jobWithStatus = (status: string) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { status }, error: null })
              })
            })
          })
        })
      }) as never;

    it("refuses a job no longer in those statuses and changes nothing", async () => {
      const { error } = await cancelJob(contextFor(jobWithStatus("Ready")), {
        ...input,
        fromStatuses: ["Draft", "Planned"]
      });

      expect(error?.category).toBe("conflict");
      expect(events).toEqual([]);
    });

    it("cancels a job still in them, guarding the status write too", async () => {
      const client = jobWithStatus("Planned");
      const { error } = await cancelJob(contextFor(client), {
        ...input,
        fromStatuses: ["Draft", "Planned"]
      });
      expect(error).toBeNull();

      expect(events).toEqual([
        "returnPickedRemainders",
        "cancelOpenPickingLists",
        "updateJobStatus"
      ]);
      expect(updateJobStatus).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ fromStatuses: ["Draft", "Planned"] })
      );
    });

    it("refuses when the job moves on between the check and the write", async () => {
      vi.mocked(updateJobStatus).mockImplementationOnce((async () => {
        events.push("updateJobStatus");
        return { data: [], error: null, updated: false };
      }) as never);

      const { error } = await cancelJob(contextFor(jobWithStatus("Planned")), {
        ...input,
        fromStatuses: ["Draft", "Planned"]
      });

      expect(error?.category).toBe("conflict");
    });
  });
});
