import { beforeEach, describe, expect, it, vi } from "vitest";

// Payment / memo / card transaction post and void over MCP
// (invoicing.mcp.server.ts → invoicing.server.ts), and the payment/memo
// upserts that must never write posting state. Stubs sit at the boundaries:
// the service role's functions.invoke (HTTP), `getUserClaims`, and the
// PostgREST builder the upserts write through.

const claims = vi.hoisted(() => ({
  current: {
    permissions: {} as Record<string, Record<string, string[]>>,
    role: "employee" as string | null
  }
}));
const edge = vi.hoisted(() => ({
  calls: [] as { name: string; body: Record<string, unknown> }[],
  response: { data: { success: true }, error: null } as {
    data: unknown;
    error: unknown;
  }
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: async () => claims.current
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    functions: {
      invoke: async (name: string, { body }: { body: Record<string, unknown> }) => {
        edge.calls.push({ name, body });
        return edge.response;
      }
    }
  })
}));

// See mcp-inventory-documents.test.ts: sales.models first, for the barrel cycle.
import "~/modules/sales/sales.models";
import {
  postPayment,
  voidCardTransaction,
  voidMemo
} from "~/modules/invoicing/invoicing.mcp.server";
import { upsertMemo, upsertPayment } from "~/modules/invoicing/invoicing.service";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

beforeEach(() => {
  edge.calls = [];
  edge.response = { data: { success: true }, error: null };
  claims.current = {
    permissions: {
      invoicing: { view: ["c1"], create: ["c1"], update: ["c1"], delete: [] }
    },
    role: "employee"
  };
});

describe("settlement posting tools", () => {
  it("refuses without invoicing update before reaching the edge function", async () => {
    claims.current.permissions.invoicing.update = [];
    await expect(
      postPayment("c1", "u1", { paymentId: "pay1" })
    ).rejects.toThrow("(invoicing update)");
    expect(edge.calls).toEqual([]);
  });

  it("posts a payment through post-payment, as the Post action does", async () => {
    expect(await postPayment("c1", "u1", { paymentId: "pay1" })).toEqual({
      data: { id: "pay1" },
      error: null
    });
    expect(edge.calls).toEqual([
      {
        name: "post-payment",
        body: { type: "post", paymentId: "pay1", userId: "u1", companyId: "c1" }
      }
    ]);
  });

  it("returns the edge function's refusal as the reason", async () => {
    edge.response = {
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ message: "Only posted memos can be voided" }),
          { status: 400 }
        )
      }
    };
    expect(await voidMemo("c1", "u1", { memoId: "m1" })).toEqual({
      data: null,
      error: {
        code: SERVICE_RULE_ERROR_CODE,
        message: "Failed to void memo: Only posted memos can be voided"
      }
    });
  });

  it("voids a card transaction through post-card-transaction", async () => {
    await voidCardTransaction("c1", "u1", { cardTransactionId: "ct1" });
    expect(edge.calls[0]).toEqual({
      name: "post-card-transaction",
      body: {
        type: "void",
        cardTransactionId: "ct1",
        userId: "u1",
        companyId: "c1"
      }
    });
  });
});

/** A PostgREST builder that records the written row and the filters, and
 *  answers `single()` with `result`. */
function writeClient(result: { data: unknown; error: unknown }) {
  const seen: { row?: Record<string, unknown>; filters: unknown[][] } = {
    filters: []
  };
  const query: Record<string, unknown> = {
    insert: (rows: Record<string, unknown>[]) => {
      seen.row = rows[0];
      return query;
    },
    update: (row: Record<string, unknown>) => {
      seen.row = row;
      return query;
    },
    eq: (...args: unknown[]) => {
      seen.filters.push(args);
      return query;
    },
    select: () => query,
    single: async () => result
  };
  return { client: { from: () => query } as never, seen };
}

const paymentForm = {
  paymentType: "Receipt" as const,
  customerId: "cust",
  paymentDate: "2026-09-07",
  currencyCode: "EUR",
  exchangeRate: 1,
  totalAmount: 10,
  bankAccount: "bank"
};

describe("payment and memo upserts never write posting state", () => {
  it("drops status and journal columns from a payment update and only matches Draft", async () => {
    const { client, seen } = writeClient({ data: { id: "pay1" }, error: null });
    await upsertPayment(client, {
      ...paymentForm,
      id: "pay1",
      updatedBy: "u1",
      ...({ status: "Posted", journalId: "j1" } as object)
    });
    expect(seen.row).not.toHaveProperty("status");
    expect(seen.row).not.toHaveProperty("journalId");
    expect(seen.row).toMatchObject({ totalAmount: 10, updatedBy: "u1" });
    expect(seen.filters).toContainEqual(["status", "Draft"]);
  });

  it("says why an update of a posted payment matched nothing", async () => {
    const { client } = writeClient({
      data: null,
      error: { code: "PGRST116", message: "0 rows" }
    });
    const result = await upsertPayment(client, {
      ...paymentForm,
      id: "pay1",
      updatedBy: "u1"
    });
    expect(result.error).toEqual({
      code: SERVICE_RULE_ERROR_CODE,
      message:
        "Payment not found, or not Draft: only draft payments can be edited."
    });
  });

  it("never inserts a posted memo", async () => {
    const { client, seen } = writeClient({ data: { id: "m1" }, error: null });
    await upsertMemo(client, {
      direction: "Credit",
      customerId: "cust",
      memoDate: "2026-09-07",
      currencyCode: "EUR",
      exchangeRate: 1,
      amount: 5,
      memoId: "CM-1",
      companyId: "c1",
      createdBy: "u1",
      ...({ status: "Posted" } as object)
    });
    expect(seen.row).not.toHaveProperty("status");
    expect(seen.row).toMatchObject({
      memoId: "CM-1",
      companyId: "c1",
      createdBy: "u1",
      amount: 5
    });
  });
});
