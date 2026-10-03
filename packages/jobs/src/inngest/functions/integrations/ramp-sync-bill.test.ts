// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { postRampInvoice } from "./ramp-sync-bill";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost" }));

// The posting operation is the boundary; each fixture installs its own behavior.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@carbon/server-functions", () => {
  const bind = (actor: string) => (fields: object) => ({
    invoke: (_name: string, input: unknown) => post({ ...fields, actor }, input)
  });
  return { serverFns: { system: bind("system"), as: bind("caller") } };
});

function postingFixture(
  initialStatus: string,
  finalStatus: string,
  error = false
) {
  const row: Record<string, unknown> = {
    id: "invoice-1",
    companyId: "company-1",
    invoiceId: "PI-1",
    status: initialStatus
  };
  post.mockReset();
  post.mockImplementation(async () => {
    row.status = finalStatus;
    return { data: null, error: error ? new Error("response lost") : null };
  });
  const client = {
    from: () => {
      let update: Record<string, unknown> | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        const matches = filters.every(([key, value]) => row[key] === value);
        if (matches && update) Object.assign(row, update);
        return { data: matches ? { ...row } : null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        update: (values: Record<string, unknown>) => {
          update = values;
          return query;
        },
        single: async () => execute(),
        maybeSingle: async () => execute(),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve)
      };
      return query;
    }
  };
  return {
    ctx: { client, companyId: "company-1" } as unknown as RampSyncContext,
    row
  };
}

describe("Ramp invoice posting observation", () => {
  it("does not confirm a successful HTTP response while the invoice remains Pending", async () => {
    const { ctx } = postingFixture("Draft", "Pending");
    expect(await postRampInvoice(ctx, "invoice-1")).toEqual({
      fail: expect.stringContaining("Pending")
    });
  });

  it("accepts a lost post response only when the stored invoice is posted", async () => {
    const { ctx, row } = postingFixture("Draft", "Open", true);
    expect(await postRampInvoice(ctx, "invoice-1")).toEqual({
      readableId: "PI-1"
    });
    expect(row.status).toBe("Open");
  });

  it.each([
    "Pending",
    "Voided"
  ])("does not restart an invoice already %s", async (status) => {
    const { ctx, row } = postingFixture(status, "Open");
    expect(await postRampInvoice(ctx, "invoice-1")).toEqual({
      fail: expect.stringContaining(status)
    });
    expect(post).not.toHaveBeenCalled();
    expect(row.status).toBe(status);
  });
});
