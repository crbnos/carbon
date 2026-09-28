import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: () => null,
  lookupEntry: () => null,
  hasEntry: () => false,
  termSlug: (s: string) => s,
  glossaryEntries: () => []
}));
vi.mock("~/modules/purchasing", () => ({}));
vi.mock("../people/people.service", () => ({}));
vi.mock("../sales/sales.service", () => ({}));
vi.mock("../accounting/accounting.service", () => ({}));

import {
  getInvoiceSettlements,
  getInvoiceSettlementsForInvoice,
  getMemoApplications
} from "./invoicing.service";

type Row = Record<string, unknown>;
function cappedClient(tables: Record<string, Row[]>, failOffset?: number) {
  const requests: URL[] = [];
  const client = createClient<Database>("http://history.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const table = url.pathname.split("/").at(-1)!;
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (table === "invoiceSettlement" && offset === failOffset) {
          return Response.json(
            { message: "Later history page failed", code: "XX000" },
            { status: 500 }
          );
        }
        let rows = tables[table] ?? [];
        for (const [key, value] of url.searchParams) {
          if (value.startsWith("eq."))
            rows = rows.filter((row) => String(row[key]) === value.slice(3));
          if (value.startsWith("in.(")) {
            const values = value.slice(4, -1).split(",");
            rows = rows.filter((row) => values.includes(String(row[key])));
          }
        }
        const limit = Math.min(
          Number(url.searchParams.get("limit") ?? 1000),
          1000
        );
        return Response.json(rows.slice(offset, offset + limit), {
          headers: {
            "content-range": `${offset}-${Math.min(offset + limit, rows.length) - 1}/${rows.length}`
          }
        });
      }
    }
  });
  return { client, requests };
}

function payment(id = "cash", status = "Posted") {
  return {
    id,
    companyId: "co",
    paymentId: `PAY-${id}`,
    status,
    paymentDate: "2026-09-09",
    currencyCode: "USD"
  };
}
function settlement(n: number, extra: Row = {}): Row {
  return {
    id: `application-${String(n).padStart(4, "0")}`,
    companyId: "co",
    paymentId: "cash",
    memoId: null,
    appliedViaPaymentId: null,
    targetSalesInvoiceId: "invoice",
    targetPurchaseInvoiceId: "invoice",
    sourceAmount: 1,
    appliedAmount: 1,
    discountAmount: 0,
    writeOffAmount: 0,
    fxGainLossAmount: 0,
    targetExchangeRate: 1,
    sourceExchangeRate: 1,
    appliedDate: "2026-09-09",
    payment: payment(),
    memo: null,
    appliedViaPayment: null,
    salesInvoice: { invoiceId: "AR-1" },
    purchaseInvoice: { invoiceId: "AP-1" },
    targetMemo: { memoId: "MEMO-1" },
    ...extra
  };
}

const rows = Array.from({ length: 1105 }, (_, index) => settlement(index));

describe("complete payment application history", () => {
  it("returns all 1,105 applications and refund target labels under the API cap", async () => {
    const { client } = cappedClient({
      invoiceSettlement: [...rows, settlement(1200, { companyId: "other" })]
    });
    const result = await getInvoiceSettlements(client, "co", "cash");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1105);
    expect(
      result.data?.reduce((sum, row) => sum + Number(row.sourceAmount), 0)
    ).toBe(1105);
    expect(result.data?.at(-1)?.targetMemo).toEqual({ memoId: "MEMO-1" });
  });

  it("refuses a partial payment total if a later application page fails", async () => {
    const { client } = cappedClient({ invoiceSettlement: rows }, 1000);
    const result = await getInvoiceSettlements(client, "co", "cash");
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("Later history page failed");
  });
});

describe.each([
  "sales",
  "purchase"
] as const)("%s invoice application history", (side) => {
  it("aggregates all source allocations before displaying the applied total", async () => {
    const { client } = cappedClient({
      invoiceSettlement: rows,
      payment: [payment()]
    });
    const result = await getInvoiceSettlementsForInvoice(
      client,
      "co",
      side,
      "invoice"
    );
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      sourceAmount: 1105,
      appliedAmount: 1105
    });
  });

  it("retains more than 1,000 distinct sources without an oversized ID lookup", async () => {
    const payments = Array.from({ length: 1105 }, (_, index) =>
      payment(`cash-${index}`)
    );
    const distinctRows = payments.map((p, index) =>
      settlement(index, { paymentId: p.id, payment: p })
    );
    const { client, requests } = cappedClient({
      invoiceSettlement: distinctRows,
      payment: payments
    });
    const result = await getInvoiceSettlementsForInvoice(
      client,
      "co",
      side,
      "invoice"
    );
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1105);
    expect(
      Math.max(...requests.map((url) => url.toString().length))
    ).toBeLessThan(8000);
  });

  it("rejects a later page failure instead of returning the first applied total", async () => {
    const { client } = cappedClient(
      { invoiceSettlement: rows, payment: [payment()] },
      1000
    );
    const result = await getInvoiceSettlementsForInvoice(
      client,
      "co",
      side,
      "invoice"
    );
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      message: "Later history page failed"
    });
  });

  it("includes only posted cash, posted direct memos, and memos consumed through posted payments", async () => {
    const memo = {
      id: "memo",
      memoId: "MEMO-1",
      companyId: "co",
      status: "Posted",
      postingDate: "2026-09-09",
      memoDate: "2026-09-09",
      currencyCode: "USD",
      direction: "Credit"
    };
    const statuses = ["Posted", "Draft", "Voided"];
    const applications = [
      settlement(0),
      ...statuses.map((status, index) =>
        settlement(index + 1, {
          paymentId: `via-${status}`,
          payment: payment(`via-${status}`, status)
        })
      ),
      settlement(4, { paymentId: null, payment: null, memoId: "memo", memo }),
      ...statuses.map((status, index) =>
        settlement(index + 5, {
          paymentId: null,
          payment: null,
          memoId: "memo",
          memo,
          appliedViaPaymentId: `via-${status}`,
          appliedViaPayment: { status }
        })
      ),
      settlement(9, {
        paymentId: null,
        payment: null,
        memoId: "draft-memo",
        memo: { ...memo, id: "draft-memo", status: "Draft" }
      })
    ];
    const { client } = cappedClient({
      invoiceSettlement: applications,
      payment: [payment(), ...statuses.map((s) => payment(`via-${s}`, s))],
      memo: [memo, { ...memo, id: "draft-memo", status: "Draft" }]
    });
    const result = await getInvoiceSettlementsForInvoice(
      client,
      "co",
      side,
      "invoice"
    );
    expect(result.error).toBeNull();
    expect(result.data?.reduce((sum, row) => sum + row.appliedAmount, 0)).toBe(
      4
    );
    expect(
      result.data?.find((row) => row.source.type === "memo")?.appliedAmount
    ).toBe(2);
  });
});

// A memo's "Applied To" card. `memoId` reaches the reader as a bare xid from the
// URL, so the tenant filter — not the id — is what bounds the read; RLS admits
// every company the caller is an employee of.
function memoApplication(n: number, extra: Row = {}): Row {
  return {
    id: `memo-application-${String(n).padStart(4, "0")}`,
    companyId: "co",
    paymentId: null,
    memoId: "memo",
    appliedViaPaymentId: null,
    targetSalesInvoiceId: "invoice",
    targetPurchaseInvoiceId: null,
    targetMemoId: null,
    targetReimbursementId: null,
    appliedAmount: 1,
    appliedDate: "2026-09-09",
    salesInvoice: { invoiceId: "AR-1" },
    purchaseInvoice: null,
    targetMemo: null,
    targetReimbursement: null,
    ...extra
  };
}

describe("memo application history", () => {
  it("scopes the read to the caller's company", async () => {
    const { client, requests } = cappedClient({
      invoiceSettlement: [
        memoApplication(0),
        memoApplication(1, { companyId: "other" })
      ]
    });
    const result = await getMemoApplications(client, "co", "memo");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.id).toBe("memo-application-0000");
    // The filter must be on the wire, not applied after the fact.
    expect(
      requests.some((url) => url.searchParams.get("companyId") === "eq.co")
    ).toBe(true);
  });

  it("scopes the posted-via-payment lookup to the caller's company too", async () => {
    const { client } = cappedClient({
      invoiceSettlement: [
        memoApplication(0, { appliedViaPaymentId: "via" }),
        memoApplication(1, { appliedViaPaymentId: "via-other" })
      ],
      payment: [payment("via"), { ...payment("via-other"), companyId: "other" }]
    });
    const result = await getMemoApplications(client, "co", "memo");
    expect(result.error).toBeNull();
    // Only the payment visible in "co" counts the credit as applied; the row
    // whose via-payment belongs to another company is staged, not applied.
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.id).toBe("memo-application-0000");
  });

  it("labels every target kind the union covers", async () => {
    const { client } = cappedClient({
      invoiceSettlement: [
        memoApplication(0),
        memoApplication(1, {
          targetSalesInvoiceId: null,
          salesInvoice: null,
          targetPurchaseInvoiceId: "ap-invoice",
          purchaseInvoice: { invoiceId: "AP-1" }
        }),
        memoApplication(2, {
          targetSalesInvoiceId: null,
          salesInvoice: null,
          targetMemoId: "other-memo",
          targetMemo: { memoId: "MEMO-2" }
        }),
        memoApplication(3, {
          targetSalesInvoiceId: null,
          salesInvoice: null,
          targetReimbursementId: "reimb",
          targetReimbursement: { reimbursementId: "REIMB-1" }
        })
      ]
    });
    const result = await getMemoApplications(client, "co", "memo");
    expect(result.error).toBeNull();
    expect(result.data?.map((row) => row.target)).toEqual([
      { type: "salesInvoice", id: "invoice", readableId: "AR-1" },
      { type: "purchaseInvoice", id: "ap-invoice", readableId: "AP-1" },
      { type: "memo", id: "other-memo", readableId: "MEMO-2" },
      { type: "reimbursement", id: "reimb", readableId: "REIMB-1" }
    ]);
  });
});
