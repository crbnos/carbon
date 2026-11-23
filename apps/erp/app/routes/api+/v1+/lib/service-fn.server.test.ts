// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AuthedContext } from "./base.server";
import { callServiceFn } from "./service-fn.server";

const cancel = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },
  async run(ctx, { jobId }) {
    if (jobId === "moved") {
      return ctx.error("conflict", "The job's status changed");
    }
    return { jobId, actor: ctx.actor.type, by: ctx.auditUserId };
  }
});

const list = defineServiceFn({
  input: z.object({}),
  permission: { view: "production" },
  async run(_ctx, _input) {
    return { rows: [{ id: "j1" }], count: 7 };
  }
});

const caller = (
  authKind: AuthedContext["authKind"],
  scopes: Record<string, string[]> = {
    production_update: ["c1"],
    production_view: ["c1"]
  }
): AuthedContext => ({
  client: {} as AuthedContext["client"],
  userId: "u1",
  companyId: "c1",
  companyGroupId: "g1",
  authKind,
  scopes
});

const single = { paginates: false };

describe("callServiceFn", () => {
  it("runs an API key as the key, with its creator as the audit user", async () => {
    await expect(
      callServiceFn(cancel, single, caller("api-key"), { jobId: "j1" })
    ).resolves.toEqual({ data: { jobId: "j1", actor: "apiKey", by: "u1" } });
  });

  it.each(["oauth", "session"] as const)(
    "runs a %s caller as its user",
    async (kind) => {
      await expect(
        callServiceFn(cancel, single, caller(kind), { jobId: "j1" })
      ).resolves.toEqual({ data: { jobId: "j1", actor: "user", by: "u1" } });
    }
  );

  it("sends a list's rows as the data and its total beside them", async () => {
    await expect(
      callServiceFn(list, { paginates: true }, caller("api-key"), {})
    ).resolves.toEqual({ data: [{ id: "j1" }], count: 7 });
  });

  it("sends a refusal as its category's code and status", async () => {
    await expect(
      callServiceFn(cancel, single, caller("oauth"), { jobId: "moved" })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "The job's status changed",
      data: { category: "conflict" }
    });
  });

  // RLS does not bound an OAuth connector or a workflow: a service function
  // can write through the direct connection, so its gate is the check.
  it.each<[AuthedContext["authKind"], Record<string, string[]>]>([
    ["api-key", { production_view: ["c1"] }],
    ["oauth", { production_update: ["c2"] }],
    ["session", { production_update: ["c2"] }]
  ])(
    "refuses a %s caller whose scopes lack the permission in this company",
    async (kind, scopes) => {
      await expect(
        callServiceFn(cancel, single, caller(kind, scopes), {
          jobId: "j1"
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  );

  it("filters an update on a company table by the caller's company", async () => {
    const filters: [string, string][] = [];
    const builder = {
      update: () => builder,
      eq: (column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      }
    };
    const touch = defineServiceFn({
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
    });

    await callServiceFn(
      touch,
      single,
      {
        ...caller("session"),
        client: { from: () => builder } as unknown as AuthedContext["client"]
      },
      { jobId: "j1" }
    );

    expect(filters).toEqual([
      ["companyId", "c1"],
      ["id", "j1"]
    ]);
  });
});
