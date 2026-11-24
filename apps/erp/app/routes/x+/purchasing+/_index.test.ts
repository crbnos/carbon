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

it("counts open purchase invoices by the view's status, as the card's link filters the list", async () => {
  const requests: URL[] = [];
  const client = createClient<Database>("http://purchasing.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return Response.json([], { headers: { "content-range": "0-0/3" } });
      }
    }
  });
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    userId: "user-a",
    companyId: "company-a"
  } as Awaited<ReturnType<typeof requirePermissions>>);

  const data = await loader({
    request: new Request("http://localhost/x/purchasing"),
    params: {},
    context: {}
  } as unknown as Parameters<typeof loader>[0]);

  const invoiceReads = requests.filter((url) =>
    url.pathname.endsWith("/purchaseInvoices")
  );
  expect(invoiceReads).toHaveLength(1);
  const statuses = invoiceReads[0]!.searchParams.get("status");
  expect(
    statuses
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
  expect(data.openPurchaseInvoices.count).toBe(3);
});
