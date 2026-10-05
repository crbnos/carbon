// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Same module-graph stubs as production.service.test.ts: the functions under
// test need neither the glossary nor the Lingui macro.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningActionsByIds,
  reopenDismissedPlanningActions
} = await import("./production.service");

// PostgREST over HTTP is the boundary: a real client, a recorded request, and
// the rows the database would have changed as the response.
function client(changedIds: string[] = []) {
  const requests: { url: URL; prefer: string | null }[] = [];
  const supabase = createClient<Database>("http://planning.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        requests.push({
          url: new URL(String(input)),
          prefer: new Headers(init?.headers).get("Prefer")
        });
        return Response.json(changedIds.map((id) => ({ id })));
      }
    }
  });
  return { supabase, requests };
}

const args = { ids: ["a1", "a2", "a3"], companyId: "c1", userId: "u1" };

// The routes reported the ids they were SENT ("Dismissed 5") while the update
// skipped rows that had changed since the page loaded.
describe("planning action worklist writes return the rows they changed", () => {
  it("dismiss changes only Open rows and returns their ids", async () => {
    const { supabase, requests } = client(["a1"]);
    const result = await dismissPlanningActions(supabase, args);
    expect(result.data).toEqual([{ id: "a1" }]);
    expect(requests[0]?.url.searchParams.get("status")).toBe("eq.Open");
    expect(requests[0]?.prefer).toContain("return=representation");
  });

  it("reopen changes only Dismissed rows and returns their ids", async () => {
    const { supabase, requests } = client(["a2"]);
    const result = await reopenDismissedPlanningActions(supabase, args);
    expect(result.data).toEqual([{ id: "a2" }]);
    expect(requests[0]?.url.searchParams.get("status")).toBe("eq.Dismissed");
    expect(requests[0]?.prefer).toContain("return=representation");
  });

  // Assign had no status condition: it re-owned actions already applied.
  it("assign never changes an applied action", async () => {
    const { supabase, requests } = client(["a1", "a3"]);
    const result = await assignPlanningActions(supabase, {
      ...args,
      assignee: "u2"
    });
    expect(result.data).toEqual([{ id: "a1" }, { id: "a3" }]);
    expect(requests[0]?.url.searchParams.get("status")).toBe(
      "in.(Open,Dismissed)"
    );
    expect(requests[0]?.url.searchParams.get("companyId")).toBe("eq.c1");
    expect(requests[0]?.prefer).toContain("return=representation");
  });
});

// Apply read each action on its own; a batch of N is now one request.
describe("getPlanningActionsByIds", () => {
  it("reads the whole batch in one company-scoped request", async () => {
    const { supabase, requests } = client();
    await getPlanningActionsByIds(supabase, {
      ids: ["a1", "a2", "a3"],
      companyId: "c1"
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.searchParams.get("id")).toBe("in.(a1,a2,a3)");
    expect(requests[0]?.url.searchParams.get("companyId")).toBe("eq.c1");
  });
});
