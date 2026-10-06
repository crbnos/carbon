// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports now reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));
vi.mock("@carbon/server-functions", () => ({
  serverFns: {
    system: () => ({
      invoke: vi.fn(async () => ({
        data: { purchaseOrderIdsBySupplierId: {} },
        error: null
      }))
    })
  }
}));
vi.mock("../app/modules/production/production.service", () => ({
  getJobReleaseReadiness: vi.fn(),
  recalculateJobRequirements: vi.fn(async () => ({ data: null, error: null })),
  runMRP: vi.fn(async () => ({ data: null, error: null })),
  updateJobStatus: vi.fn(async () => ({ error: null, updated: true }))
}));

import {
  runMRP,
  updateJobStatus
} from "../app/modules/production/production.service";
import { releaseJobs } from "../app/modules/production/production.server";

// The release-date write: a chainable, thenable stand-in for the user client.
function clientWith(stamp: { error: null | { message: string } }) {
  const chain: Record<string, any> = {};
  for (const method of ["update", "eq"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, ...stamp }).then(resolve);
  return { from: () => chain } as any;
}

const release = (client: any, jobIds = ["job-1"]) =>
  releaseJobs({
    client,
    db: {} as any,
    jobIds,
    companyId: "company-1",
    userId: "user-1",
    purchaseOrdersBySupplierId: {}
  });

beforeEach(() => vi.clearAllMocks());

describe("releaseJobs", () => {
  it("releases past a failed MRP run", async () => {
    vi.mocked(runMRP).mockResolvedValueOnce({
      data: null,
      error: new Error("planning blew up")
    });
    const result = await release(clientWith({ error: null }));
    expect(result).toEqual({
      error: null,
      purchaseOrdersBySupplierId: {},
      releasedJobIds: ["job-1"]
    });
  });

  it("flips only a job still Draft or Planned, and stops when it is not", async () => {
    vi.mocked(updateJobStatus).mockResolvedValueOnce({
      error: null,
      updated: false
    } as any);
    const result = await release(clientWith({ error: null }), [
      "job-1",
      "job-2"
    ]);
    expect(vi.mocked(updateJobStatus).mock.calls[0]?.[1]).toMatchObject({
      status: "Ready",
      fromStatuses: ["Draft", "Planned"]
    });
    expect(result).toEqual({
      error: "The job is no longer Draft or Planned",
      purchaseOrdersBySupplierId: {},
      releasedJobIds: []
    });
  });

  it("reports a failed release-date write on a job that is released", async () => {
    const result = await release(
      clientWith({ error: { message: "connection reset" } })
    );
    expect(result).toEqual({
      error: "The job is released, but its release date could not be saved",
      purchaseOrdersBySupplierId: {},
      releasedJobIds: ["job-1"]
    });
  });
});
