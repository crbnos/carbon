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
vi.mock("../accounting/accounting.ee.service", () => ({}));

import {
  getInvoicePaidAmounts,
  getInvoiceSettlements,
  getInvoiceSettlementsForInvoice
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

describe("getInvoicePaidAmounts", () => {
  it.each([
    "sales",
    "purchase"
  ] as const)("paginates %s cash principal and scopes invoices and payment tenant/status", async (side) => {
    const rows = Array.from({ length: 1013 }, (_, i) =>
      settlement(i, {
        appliedAmount: i === 1012 ? -2 : 1,
        "payment.companyId": "co",
        "payment.status": "Posted"
      })
    );
    rows.push(
      settlement(99, {
        appliedAmount: 100,
        "payment.companyId": "co",
        "payment.status": "Draft"
      })
    );
    rows.push(
      settlement(100, {
        appliedAmount: 100,
        "payment.companyId": "other",
        "payment.status": "Posted"
      })
    );
    rows.push(
      settlement(101, { appliedAmount: 100, paymentId: null, memoId: "credit" })
    );
    const { client, requests } = cappedClient({ invoiceSettlement: rows });
    const result = await getInvoicePaidAmounts(client, "co", side, ["invoice"]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ invoice: 1010 });
    expect(requests.length).toBeGreaterThan(1);
    for (const url of requests) {
      expect(url.searchParams.get("companyId")).toBe("eq.co");
      expect(url.searchParams.get("payment.companyId")).toBe("eq.co");
      expect(url.searchParams.get("payment.status")).toBe("eq.Posted");
      expect(
        url.searchParams.get(
          side === "sales" ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId"
        )
      ).toBe("in.(invoice)");
      expect(url.searchParams.get("select")).toContain("!inner(status)");
    }
  });

  it("does not query for an empty invoice set", async () => {
    const { client, requests } = cappedClient({});
    expect(await getInvoicePaidAmounts(client, "co", "sales", [])).toEqual({
      data: {},
      error: null
    });
    expect(requests).toHaveLength(0);
  });
});
