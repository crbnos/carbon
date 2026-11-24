// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { seedCompanyReferenceData } from "./bootstrap.ts";
import { insertId } from "./sql.ts";
import type { Ctx } from "./types.ts";
import { resolveCheckUserId } from "./verify.ts";
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

const databaseUrl = process.env.SUPABASE_DB_URL;
const hasLocalDatabase =
  databaseUrl &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname);

describe.skipIf(!hasLocalDatabase)("wiping payment requests", () => {
  it.each(["Planned", "Paid"] as const)(
    "removes %s requests with their invoices and payments",
    async (status) => {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      const pg = client as unknown as PoolClient;
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);
        const userId = await resolveCheckUserId(pg);
        if (!userId) throw new Error("A local test user is required");
        const company = await seedCompanyReferenceData(pg, {
          userId,
          companyName: "Payment request wipe check"
        });
        const ctx = {
          client: pg,
          ...company,
          userId,
          anchor: parseDate("2026-11-23")
        } as Ctx;
        const supplierId = await insertId(ctx, "supplier", {
          name: "Wipe check supplier",
          currencyCode: "USD"
        });
        const supplierInteractionId = await insertId(
          ctx,
          "supplierInteraction",
          {
            supplierId
          }
        );
        const purchaseInvoiceId = await insertId(ctx, "purchaseInvoice", {
          invoiceId: "AP-WIPE",
          supplierId,
          supplierInteractionId,
          currencyCode: "USD"
        });
        let paymentId: string | null = null;
        if (status === "Paid") {
          const bankAccount = await client.query<{ id: string }>(
            `SELECT id FROM account WHERE "companyGroupId" = $1 AND number = '1010'`,
            [company.companyGroupId]
          );
          paymentId = await insertId(ctx, "payment", {
            paymentId: "PAY-WIPE",
            paymentType: "Disbursement",
            status: "Posted",
            supplierId,
            paymentDate: "2026-11-23",
            currencyCode: "USD",
            totalAmount: 100,
            bankAccount: bankAccount.rows[0]?.id
          });
        }
        await insertId(ctx, "paymentRequest", {
          purchaseInvoiceId,
          requestNumber: 1,
          status,
          amount: status === "Paid" ? 100 : null,
          dueDate: status === "Paid" ? "2026-11-23" : null,
          currencyCode: "USD",
          paymentId
        });

        await wipeCompanyBusinessData(ctx);

        const remaining = await client.query(
          `SELECT
             (SELECT count(*)::int FROM "paymentRequest" WHERE "companyId" = $1) AS requests,
             (SELECT count(*)::int FROM "purchaseInvoice" WHERE "companyId" = $1) AS invoices,
             (SELECT count(*)::int FROM payment WHERE "companyId" = $1) AS payments`,
          [company.companyId]
        );
        expect(remaining.rows).toEqual([
          { requests: 0, invoices: 0, payments: 0 }
        ]);
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
    60_000
  );
});
