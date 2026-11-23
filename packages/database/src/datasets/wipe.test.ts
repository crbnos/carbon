// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { Ctx } from "./types.ts";
import { wipeCompanyBusinessData } from "./wipe.ts";

/**
 * A `PoolClient` that answers the wipe's three pre-flight guard queries and
 * refuses everything after them, so a guard that does NOT fire surfaces as
 * "the wipe continued" rather than as a green test.
 */
function stubCtx(
  counts: { partners?: number; charges?: number; reimbursements?: number } = {}
) {
  const client = {
    query: async (sql: string) => {
      // The journal walk NAMES the reimbursement table in a subquery, so it has
      // to be matched before the guard counts below.
      if (sql.includes("FROM journal j")) {
        // No journals to void — the pass returns before writing anything.
        return { rows: [] };
      }
      if (sql.includes("intercompanyCompanyId")) {
        return { rows: [{ count: counts.partners ?? 0 }] };
      }
      if (sql.includes('count(*) AS count FROM "charge"')) {
        return { rows: [{ count: counts.charges ?? 0 }] };
      }
      if (sql.includes('count(*) AS count FROM "reimbursement"')) {
        return { rows: [{ count: counts.reimbursements ?? 0 }] };
      }
      throw new Error("wipe-continued-past-the-guards");
    }
  } as unknown as PoolClient;
  return { client, companyId: "co_1" } as unknown as Ctx;
}

describe("assertWipeable", () => {
  it("refuses a company that has posted reimbursements", async () => {
    // `check_reimbursement_draft_mutation` refuses to DELETE any non-Draft row
    // and does not honour app.sync_in_progress, so without this guard the
    // template apply aborted mid-wipe on a raw trigger error — and the row
    // cannot be walked back to Draft the way an invoice can.
    const ctx = stubCtx({ reimbursements: 3 });
    await expect(wipeCompanyBusinessData(ctx)).rejects.toThrow(
      "3 posted or voided reimbursement(s)"
    );
  });

  it("proceeds when every reimbursement is still Draft", async () => {
    const ctx = stubCtx({ reimbursements: 0 });
    await expect(wipeCompanyBusinessData(ctx)).rejects.toThrow(
      "wipe-continued-past-the-guards"
    );
  });
});

describe("wipeCompanyBusinessData", () => {
  it("deletes the tax subledger with the documents whose journals it voids", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("intercompanyCompanyId"))
          return { rows: [{ count: 0 }] };
        if (sql.includes("count(*) AS count")) return { rows: [{ count: 0 }] };
        if (sql.includes("FROM information_schema.tables")) {
          return {
            rows: ["journal", "taxLedger", "memo"].map((table_name) => ({
              table_name
            }))
          };
        }
        return { rows: [] };
      }
    } as unknown as PoolClient;
    await wipeCompanyBusinessData({
      client,
      companyId: "co_1",
      anchor: "2026-11-20",
      userId: "u"
    } as unknown as Ctx);
    expect(queries).toContain('DELETE FROM "taxLedger" WHERE "companyId" = $1');
    expect(queries).not.toContain(
      'DELETE FROM "journal" WHERE "companyId" = $1'
    );
  });
});
