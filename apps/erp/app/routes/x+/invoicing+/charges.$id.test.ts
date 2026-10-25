// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loader } from "./charges.$id";

vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));

// PostgREST answered over a stubbed fetch: one table fails, the rest succeed.
function clientFailing(failingTable: string) {
  return createClient<Database>("http://charge.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const table = new URL(String(input)).pathname.split("/").at(-1);
        if (table === failingTable) {
          return Response.json({ message: "lookup failed" }, { status: 500 });
        }
        if (table === "charge") {
          return Response.json({
            id: "card-1",
            cardAccountId: "card-account",
            offsetAccountId: null,
            journalId: null,
            chargeLine: [{ id: "line-1", accountId: "expense-account" }]
          });
        }
        return Response.json([]);
      }
    }
  });
}

it.each(["account", "document"])(
  "redirects instead of rendering a partial charge when the %s read fails",
  async (table) => {
    vi.mocked(requirePermissions).mockResolvedValue({
      client: clientFailing(table),
      companyId: "company-a",
      companyGroupId: "group-a"
    } as Awaited<ReturnType<typeof requirePermissions>>);

    await expect(
      loader({
        request: new Request("http://localhost/x/invoicing/charges/card-1"),
        params: { id: "card-1" },
        context: {}
      } as unknown as Parameters<typeof loader>[0])
    ).rejects.toMatchObject({ status: 302 });
  }
);
