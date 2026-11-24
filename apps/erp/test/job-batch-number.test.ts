// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The job page's Serial / Batch Number field: it writes as the system, as the
// route always did, so it may only reach a unit of the job it names.

vi.mock("@carbon/jobs", () => ({ trigger: vi.fn(), batchTrigger: vi.fn() }));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: vi.fn() }));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("@carbon/planning", () => ({
  runMrp: vi.fn(async () => null),
  runLocationSchedule: vi.fn()
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import { updateJobBatchNumber } from "../app/modules/production/production.server";
import { filteringSupabase } from "./filtering-supabase-fake";

const JOB_MAKE_METHOD = "attributes->>Job Make Method";

// The caller's client: touching it fails the test, since the trackedEntity
// write needs inventory update under RLS and the field needs production only.
const untouched = new Proxy(
  {},
  {
    get(_, key) {
      throw new Error(`The write must not run as the caller (${String(key)})`);
    }
  }
);

function contextWith(tables: Record<string, any[]>) {
  const system = filteringSupabase(tables);
  const ctx = createServiceContext({
    actor: {
      type: "apiKey",
      createdBy: "user-1",
      scopes: {
        production: {
          view: [],
          create: [],
          update: ["company-1"],
          delete: []
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: untouched as never,
    system: () => system.client,
    pg: () => untouched as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: system.writes };
}

const tables = {
  jobMakeMethod: [
    { id: "jmm-root", jobId: "job-1", companyId: "company-1" },
    { id: "jmm-sub", jobId: "job-1", companyId: "company-1" },
    { id: "jmm-other", jobId: "job-2", companyId: "company-1" }
  ],
  trackedEntity: [
    { id: "te-sub", companyId: "company-1", [JOB_MAKE_METHOD]: "jmm-sub" },
    { id: "te-other", companyId: "company-1", [JOB_MAKE_METHOD]: "jmm-other" }
  ]
};

describe("updateJobBatchNumber", () => {
  it("renames a unit of the job's sub-assembly as the system, trimmed", async () => {
    const { ctx, writes } = contextWith(tables);

    const result = await updateJobBatchNumber(ctx, {
      jobId: "job-1",
      trackedEntityId: "te-sub",
      value: "  SN-7 "
    });

    expect(result.error).toBeNull();
    expect(writes).toEqual([
      {
        table: "trackedEntity",
        op: "update",
        value: { readableId: "SN-7" },
        filters: [
          ["id", "te-sub"],
          ["companyId", "company-1"]
        ]
      }
    ]);
  });

  it("refuses a unit of another job", async () => {
    const { ctx } = contextWith(tables);

    const result = await updateJobBatchNumber(ctx, {
      jobId: "job-1",
      trackedEntityId: "te-other",
      value: "SN-8"
    });

    expect(result.error?.category).toBe("notFound");
  });

  it("clears a blank number", async () => {
    const { ctx, writes } = contextWith(tables);

    await updateJobBatchNumber(ctx, {
      jobId: "job-1",
      trackedEntityId: "te-sub",
      value: " "
    });

    expect(writes[0]?.value).toEqual({ readableId: null });
  });
});
