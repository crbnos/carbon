// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ManifestEntry } from "@carbon/api";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));
vi.mock("@carbon/kv", () => ({ redis: {} }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
// A real service function stands in for the ERP router.
vi.mock("~/modules/router.server", async () => {
  const { z } = await import("zod");
  const { defineServiceFn } = await import("@carbon/api/service-fn.server");
  return {
    router: {
      production: {
        job: {
          cancel: defineServiceFn({
            input: z.object({ jobId: z.string() }),
            permission: { update: "production" },
            async run(ctx, { jobId }) {
              if (jobId === "moved") {
                return ctx.error("conflict", "The job's status changed");
              }
              return { jobId, actor: ctx.actor.type, by: ctx.auditUserId };
            }
          }),
          // Records the filters an update on the caller's client carries.
          touch: defineServiceFn({
            input: z.object({ jobId: z.string() }),
            permission: { update: "production" },
            async run(ctx, { jobId }) {
              const client = ctx.asCaller.supabase as unknown as {
                from(table: string): {
                  update(row: object): { eq(c: string, v: string): unknown };
                };
              };
              client.from("job").update({ name: "x" }).eq("id", jobId);
              return { jobId };
            }
          })
        }
      }
    }
  };
});

import type { AuthedContext } from "./base.server";
import { runServiceFn } from "./service-fn.server";

const meta = {
  name: "production_cancelJob",
  serviceFn: { path: ["production", "job", "cancel"] }
} as ManifestEntry;

const caller = (
  authKind: AuthedContext["authKind"],
  scopes: Record<string, string[]> = { production_update: ["c1"] }
): AuthedContext => ({
  client: {} as AuthedContext["client"],
  userId: "u1",
  companyId: "c1",
  companyGroupId: "g1",
  authKind,
  scopes
});

describe("runServiceFn", () => {
  it("runs the function as the key, with its creator as the audit user", async () => {
    await expect(
      runServiceFn(meta, caller("api-key"), { jobId: "j1" })
    ).resolves.toEqual({ data: { jobId: "j1", actor: "apiKey", by: "u1" } });
  });

  it("runs an OAuth or workflow caller as its user", async () => {
    const { data } = await runServiceFn(meta, caller("session"), {
      jobId: "j1"
    });
    expect(data).toMatchObject({ actor: "user" });
  });

  it("sends a refusal as its category's code and status", async () => {
    await expect(
      runServiceFn(meta, caller("oauth"), { jobId: "moved" })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "The job's status changed",
      data: { category: "conflict" }
    });
  });

  it("refuses a caller whose scopes lack the function's permission", async () => {
    await expect(
      runServiceFn(meta, caller("api-key", { production_view: ["c1"] }), {
        jobId: "j1"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  // RLS does not bound an OAuth connector or a workflow: a service function
  // can write through the direct connection, so its gate is the check.
  it("refuses an OAuth or workflow caller whose user lacks the permission", async () => {
    for (const kind of ["oauth", "session"] as const) {
      await expect(
        runServiceFn(meta, caller(kind, { production_update: ["c2"] }), {
          jobId: "j1"
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });
});

describe("an API caller's client", () => {
  it("filters an update on a company table by the caller's company", async () => {
    const filters: [string, string][] = [];
    const builder = {
      update: () => builder,
      eq: (column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      }
    };
    const context = {
      ...caller("session"),
      client: { from: () => builder } as unknown as AuthedContext["client"]
    };
    await runServiceFn(
      {
        name: "production_job_touch",
        serviceFn: { path: ["production", "job", "touch"] }
      } as ManifestEntry,
      context,
      { jobId: "j1" }
    );
    expect(filters).toEqual([
      ["companyId", "c1"],
      ["id", "j1"]
    ]);
  });
});
