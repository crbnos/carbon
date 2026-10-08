// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: vi.fn() }));
vi.mock("@carbon/lib/telemetry", () => ({
  asJobSource: vi.fn(),
  trackWorkEvent: vi.fn()
}));

import { raiseMoment } from "@carbon/lib/workflows";
import { updateJobStatus } from "../app/modules/production/production.service";

// A job row behind a chainable client stand-in. The UPDATE applies its `in`
// filter on the status, as the database would, and returns the rows it changed.
function clientWith(job: { id: string; status: string }) {
  const calls: string[] = [];
  const chain: Record<string, any> = {};
  let statusFilter: string[] | null = null;
  for (const method of ["select", "update", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.in = vi.fn((_column: string, values: string[]) => {
    calls.push("in");
    statusFilter = values;
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => ({
    data: { status: job.status },
    error: null
  }));
  chain.then = (resolve: (value: unknown) => unknown) => {
    const matched = !statusFilter || statusFilter.includes(job.status);
    return Promise.resolve({
      data: matched ? [{ id: job.id }] : [],
      error: null
    }).then(resolve);
  };
  return { client: { from: () => chain } as any, calls };
}

const release = (client: any) =>
  updateJobStatus(client, {
    id: "job-1",
    companyId: "company-1",
    status: "Ready",
    updatedBy: "user-1",
    fromStatuses: ["Draft", "Planned"]
  });

beforeEach(() => vi.clearAllMocks());

describe("updateJobStatus with fromStatuses", () => {
  it("flips a job that is still waiting for release", async () => {
    const { client, calls } = clientWith({ id: "job-1", status: "Planned" });
    const result = await release(client);
    expect(calls).toEqual(["in"]);
    expect(result.updated).toBe(true);
    expect(raiseMoment).toHaveBeenCalledTimes(1);
  });

  it("leaves a job someone cancelled in the meantime alone", async () => {
    const { client } = clientWith({ id: "job-1", status: "Cancelled" });
    const result = await release(client);
    expect(result.error).toBeNull();
    expect(result.updated).toBe(false);
    expect(raiseMoment).not.toHaveBeenCalled();
  });

  it("flips without a guard when no statuses are given", async () => {
    const { client, calls } = clientWith({ id: "job-1", status: "Cancelled" });
    const result = await updateJobStatus(client, {
      id: "job-1",
      companyId: "company-1",
      status: "Ready",
      updatedBy: "user-1"
    });
    expect(calls).toEqual([]);
    expect(result.updated).toBe(true);
  });
});
