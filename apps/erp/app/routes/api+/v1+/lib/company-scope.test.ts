// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import raw from "../../mcp+/lib/tool-metadata.json";
import { scopedToCompany } from "./company-scope.server";

// The real supabase-js client, with only the network replaced: what is
// asserted is the request PostgREST would receive.
function recordingClient() {
  const requests: Array<{
    method: string;
    path: string;
    query: URLSearchParams;
  }> = [];
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          query: url.searchParams
        });
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  });
  return { client, requests };
}

const tables = new Set(["customer", "job"]);

describe("the client a service is handed", () => {
  it("filters an update by the caller's company, whatever the service filters on", async () => {
    const { client, requests } = recordingClient();
    await scopedToCompany(client, "c1", tables)
      .from("customer")
      .update({ name: "Acme" })
      .eq("id", "cust-of-another-company")
      .select("id");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.query.get("id")).toBe("eq.cust-of-another-company");
    expect(requests[0]?.query.get("companyId")).toBe("eq.c1");
  });

  it("filters a delete the same way", async () => {
    const { client, requests } = recordingClient();
    await scopedToCompany(client, "c1", tables)
      .from("job")
      .delete()
      .eq("id", "job1");

    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.query.get("companyId")).toBe("eq.c1");
  });

  it("leaves a service's own company filter standing beside it", async () => {
    const { client, requests } = recordingClient();
    await scopedToCompany(client, "c1", tables)
      .from("job")
      .update({ status: "Ready" })
      .eq("id", "job1")
      .eq("companyId", "c1");

    expect(requests[0]?.query.getAll("companyId")).toEqual(["eq.c1", "eq.c1"]);
  });

  it("does not touch a read or an insert", async () => {
    const { client, requests } = recordingClient();
    const scoped = scopedToCompany(client, "c1", tables);
    await scoped.from("customer").select("*").eq("id", "cust1");
    await scoped.from("customer").insert({ name: "Acme" });

    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(requests[0]?.query.has("companyId")).toBe(false);
    expect(requests[1]?.query.has("companyId")).toBe(false);
  });

  it("does not filter a table that has no companyId column", async () => {
    const { client, requests } = recordingClient();
    await scopedToCompany(client, "c1", tables)
      .from("company")
      .update({ name: "Acme" })
      .eq("id", "c1");

    expect(requests[0]?.query.has("companyId")).toBe(false);
  });

  it("passes everything else through to the real client", async () => {
    const { client, requests } = recordingClient();
    await scopedToCompany(client, "c1", tables).rpc("get_claims", {
      uid: "u1"
    });

    expect(requests[0]?.path).toBe("/rest/v1/rpc/get_claims");
  });

  it("knows the tables from the generated database types", () => {
    const companyTables = (raw as { companyTables: string[] }).companyTables;
    expect(companyTables).toEqual(
      expect.arrayContaining([
        "customer",
        "job",
        "salesOrder",
        "purchaseInvoice"
      ])
    );
    // Not tenant rows: the company itself, and the user it is not scoped to.
    expect(companyTables).not.toContain("company");
    expect(companyTables).not.toContain("user");
  });
});
