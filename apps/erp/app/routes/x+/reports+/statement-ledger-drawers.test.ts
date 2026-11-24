// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loader as balanceSheetLedger } from "./balance-sheet.$accountId";
import { loader as incomeStatementLedger } from "./income-statement.$accountId";

vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/kv", () => ({
  redis: { get: async () => null, set: async () => "OK" }
}));

// 02:30 UTC on 24 November is still 23 November in the company's timezone,
// so a window ending on the UTC day would read a day the report does not.
const NOW = Date.UTC(2026, 10, 24, 2, 30);

type Window = { from: string | null; to: string | null };

function ledgerClient() {
  const reads: { lines?: Window; summary?: Window } = {};
  const client = createClient<Database>("http://ledger.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const resource = url.pathname.split("/").at(-1);
        if (resource === "company") {
          return Response.json([{ timezone: "America/Chicago" }]);
        }
        if (resource === "account") {
          return Response.json({ id: "account-1", name: "Rent Expense" });
        }
        if (resource === "journalLines") {
          const bound = (op: string) =>
            url.searchParams
              .getAll("postingDate")
              .find((value) => value.startsWith(`${op}.`))
              ?.slice(op.length + 1) ?? null;
          reads.lines = { from: bound("gte"), to: bound("lte") };
          return Response.json([], { headers: { "content-range": "*/0" } });
        }
        if (resource === "accountTreeBalancesByCompany") {
          const body = JSON.parse(String(init?.body));
          reads.summary = { from: body.from_date, to: body.to_date };
        }
        return Response.json([]);
      }
    }
  });
  return { client, reads };
}

async function openDrawer(
  loader: typeof incomeStatementLedger | typeof balanceSheetLedger,
  search: string
) {
  const { client, reads } = ledgerClient();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    companyGroupId: "group-1"
  } as Awaited<ReturnType<typeof requirePermissions>>);

  const result = await loader({
    request: new Request(`http://localhost/x/report/account-1${search}`),
    params: { accountId: "account-1" },
    context: {}
  } as unknown as Parameters<typeof loader>[0]);

  return {
    shown: { startDate: result.startDate, endDate: result.endDate },
    ...reads
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("income statement ledger drawer", () => {
  it.each([
    ["no dates", "", "2026-06-01", "2026-11-23"],
    ["an end date only", "?endDate=2026-03-31", "2025-10-01", "2026-03-31"],
    ["a start date only", "?startDate=2026-01-01", "2026-01-01", "2026-11-23"]
  ])(
    "reads the report's window when the URL has %s",
    async (_case, search, from, to) => {
      expect(await openDrawer(incomeStatementLedger, search)).toEqual({
        shown: { startDate: from, endDate: to },
        lines: { from, to },
        summary: { from, to }
      });
    }
  );
});

describe("balance sheet ledger drawer", () => {
  it("reads through the company's today when the URL has no end date", async () => {
    expect(await openDrawer(balanceSheetLedger, "")).toEqual({
      shown: { startDate: null, endDate: "2026-11-23" },
      lines: { from: expect.any(String), to: "2026-11-23" },
      summary: { from: expect.any(String), to: "2026-11-23" }
    });
  });
});
