// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loader } from "./_index";

vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("@carbon/ee/approvals.server", () => ({
  getPendingApprovalsForApprover: async () => ({ data: [], error: null })
}));

/** Runs the loader over PostgREST answered by `respond`, and records every
 *  request it sends. */
async function loadDashboard(respond: (url: URL) => Response) {
  const requests: URL[] = [];
  const client = createClient<Database>("http://purchasing.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return respond(url);
      }
    }
  });
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    userId: "user-a",
    companyId: "company-a"
  } as Awaited<ReturnType<typeof requirePermissions>>);

  const result = loader({
    request: new Request("http://localhost/x/purchasing"),
    params: {},
    context: {}
  } as unknown as Parameters<typeof loader>[0]);
  return { result, requests };
}

const isInvoiceRead = (url: URL) => url.pathname.endsWith("/purchaseInvoices");

it("counts open purchase invoices by the view's status, as the card's link filters the list", async () => {
  const { result, requests } = await loadDashboard(() =>
    Response.json([], { headers: { "content-range": "0-0/3" } })
  );
  const data = await result;

  const invoiceReads = requests.filter(isInvoiceRead);
  expect(invoiceReads).toHaveLength(1);
  const params = invoiceReads[0]!.searchParams;
  expect(
    params
      .get("status")
      ?.replace(/^in\.\((.*)\)$/, "$1")
      .split(",")
      .sort()
  ).toEqual([
    "Draft",
    "Open",
    "Overdue",
    "Partially Paid",
    "Pending",
    "Return"
  ]);
  // The newest ten, so a recent draft is not cut by older open bills.
  expect(params.get("order")).toBe("createdAt.desc,id.desc");
  expect(data.openPurchaseInvoices.count).toBe(3);
});

it("fails the page instead of showing no open invoices when the count read fails", async () => {
  const { result } = await loadDashboard((url) =>
    isInvoiceRead(url)
      ? Response.json({ message: "statement timeout" }, { status: 500 })
      : Response.json([])
  );

  await expect(result).rejects.toMatchObject({ status: 500 });
});
