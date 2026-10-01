// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobStepRecords } from "~/modules/inventory/lineage.server";
import { loader } from "./traceability.sidebar";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/inventory/lineage.server", () => ({
  fetchJobStepRecords: vi.fn(async () => [{ id: "step-record-1" }])
}));

type Row = Record<string, unknown> | null;

function createQuery(data: Row) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error: null }))
  };
  return query;
}

function setup({ activity, job }: { activity: Row; job: Row }) {
  const activityQuery = createQuery(activity);
  const jobQuery = createQuery(job);
  const client = {
    from: vi.fn((table: string) => {
      if (table === "trackedActivity") return activityQuery;
      if (table === "job") return jobQuery;
      throw new Error(`Unexpected table query: ${table}`);
    }),
    rpc: vi.fn()
  };
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1"
  } as any);
  return { client, activityQuery, jobQuery };
}

async function load(query: string) {
  const response = await loader({
    request: new Request(`http://localhost/api/traceability/sidebar?${query}`)
  } as any);
  return { status: response.status, body: await response.json() };
}

describe("traceability sidebar loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes the activity and its job to the caller's company", async () => {
    const { client, activityQuery, jobQuery } = setup({
      activity: { attributes: { Job: "job-1" } },
      job: { id: "job-1" }
    });

    const { status, body } = await load("activityId=activity-1");

    expect(status).toBe(200);
    expect(body).toEqual({ stepRecords: [{ id: "step-record-1" }] });
    expect(activityQuery.eq).toHaveBeenCalledWith("id", "activity-1");
    expect(activityQuery.eq).toHaveBeenCalledWith("companyId", "company-1");
    expect(jobQuery.eq).toHaveBeenCalledWith("id", "job-1");
    expect(jobQuery.eq).toHaveBeenCalledWith("companyId", "company-1");
    expect(fetchJobStepRecords).toHaveBeenCalledWith(
      client,
      "job-1",
      "company-1"
    );
  });

  it("returns no step records for another company's activity", async () => {
    const { client, jobQuery } = setup({ activity: null, job: null });

    const { status, body } = await load("activityId=foreign-activity");

    expect(status).toBe(200);
    expect(body).toEqual({ stepRecords: [] });
    expect(jobQuery.maybeSingle).not.toHaveBeenCalled();
    expect(fetchJobStepRecords).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns no step records when the activity names another company's job", async () => {
    const { client } = setup({
      activity: { attributes: { Job: "foreign-job" } },
      job: null
    });

    const { status, body } = await load("activityId=activity-1");

    expect(status).toBe(200);
    expect(body).toEqual({ stepRecords: [] });
    expect(fetchJobStepRecords).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns no step records without an activityId", async () => {
    const { client } = setup({ activity: null, job: null });

    const { status, body } = await load("");

    expect(status).toBe(200);
    expect(body).toEqual({ stepRecords: [] });
    expect(client.from).not.toHaveBeenCalled();
    expect(fetchJobStepRecords).not.toHaveBeenCalled();
  });
});
