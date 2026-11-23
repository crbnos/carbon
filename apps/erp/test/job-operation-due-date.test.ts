// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Pinning an operation's need-by tells the scheduler only when a row changed.
// An id of another company (or none) matched no row, answered success and still
// sent the reorder event. The boundaries are PostgREST (a real supabase-js
// client whose HTTP is answered here) and the event bus.

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger, batchTrigger: vi.fn() }));

import { createServiceContext } from "@carbon/api/service-fn.server";
import { createClient } from "@supabase/supabase-js";
import { setJobOperationDueDate } from "../app/modules/production/production.server";

/** A caller whose PATCH matches `rows`. */
function callerMatching(rows: { id: string }[]) {
  const patches: { url: URL; body: Record<string, unknown> }[] = [];
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push({
            url: new URL(String(input)),
            body: JSON.parse(String(init.body))
          });
        }
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }) as typeof fetch
    }
  });
  const ctx = createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: [], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: client as never,
    system: () => {
      throw new Error("The pin uses the caller's client");
    },
    pg: () => {
      throw new Error("The pin opens no transaction");
    },
    kv: () => {
      throw new Error("The pin uses no kv");
    }
  });
  return { ctx, patches };
}

beforeEach(() => vi.clearAllMocks());

describe("setJobOperationDueDate", () => {
  it("pins the date on the company's operation, then tells the scheduler", async () => {
    const { ctx, patches } = callerMatching([{ id: "op1" }]);

    const result = await setJobOperationDueDate(ctx, {
      id: "op1",
      dueDate: "2026-11-02"
    });

    expect(result).toEqual({ data: { id: "op1" }, error: null });
    expect(patches).toHaveLength(1);
    expect(patches[0].url.searchParams.get("companyId")).toBe("eq.c1");
    expect(patches[0].body).toMatchObject({
      dueDate: "2026-11-02",
      manuallyScheduled: true
    });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("refuses an operation that matched no row, and tells no one", async () => {
    const { ctx } = callerMatching([]);

    const { error } = await setJobOperationDueDate(ctx, {
      id: "another-company-op",
      dueDate: null
    });

    expect(error?.category).toBe("notFound");
    expect(trigger).not.toHaveBeenCalled();
  });
});
