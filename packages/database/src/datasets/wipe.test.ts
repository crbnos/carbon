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
  const journalSourceTypes: string[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      // The journal walk NAMES the reimbursement table in a subquery, so it has
      // to be matched before the guard counts below.
      if (sql.includes("FROM journal j")) {
        journalSourceTypes.push(...((params?.[1] as string[]) ?? []));
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
  return {
    ctx: { client, companyId: "co_1" } as unknown as Ctx,
    journalSourceTypes
  };
}

describe("assertWipeable", () => {
  it("refuses a company that has posted reimbursements", async () => {
    // `check_reimbursement_draft_mutation` refuses to DELETE any non-Draft row
    // and does not honour app.sync_in_progress, so without this guard the
    // template apply aborted mid-wipe on a raw trigger error — and the row
    // cannot be walked back to Draft the way an invoice can.
    const { ctx } = stubCtx({ reimbursements: 3 });
    await expect(wipeCompanyBusinessData(ctx)).rejects.toThrow(
      "3 posted or voided reimbursement(s)"
    );
  });

  it("proceeds when every reimbursement is still Draft", async () => {
    const { ctx } = stubCtx({ reimbursements: 0 });
    await expect(wipeCompanyBusinessData(ctx)).rejects.toThrow(
      "wipe-continued-past-the-guards"
    );
  });
});

describe("reverseDocumentJournals", () => {
  it("counts Reimbursement among the document journal sources", async () => {
    const { ctx, journalSourceTypes } = stubCtx();
    await expect(wipeCompanyBusinessData(ctx)).rejects.toThrow(
      "wipe-continued-past-the-guards"
    );
    expect(journalSourceTypes).toContain("Reimbursement");
  });
});
