import type { RampClient } from "@carbon/ee/ramp.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RampBillPaymentDependencies,
  syncRampBillPayment
} from "./ramp-sync-payment";
import {
  type RampReimbursementDependencies,
  syncRampReimbursement
} from "./ramp-sync-reimbursement";
import { syncRampRepayments } from "./ramp-sync-repayment";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));

afterEach(() => vi.restoreAllMocks());

describe("Ramp inbound accounting discriminators", () => {
  it.each([
    "ACH",
    "CHECK",
    "DIRECT_DEBIT",
    "DOMESTIC_WIRE",
    "FED_NOW",
    "INTERNATIONAL",
    "LOCAL_BANK_TRANSFER",
    "RTP",
    "SWIFT"
  ])("continues invoice resolution for verified bank method %s", async (payment_method) => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    const outcome = await syncRampBillPayment(
      { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
      { id: "bill-1" },
      { id: "payment-1", payment_method }
    );
    expect(outcome).toEqual({
      fail: {
        id: "payment-1",
        message: "Bill was never synced to Carbon — sync the bill first"
      }
    });
    expect(getMappedInvoiceId).toHaveBeenCalledWith("bill-1");
  });

  /**
   * A mapped reimbursement's DOCUMENT is never re-read, so the deps only have to
   * answer the mapping lookup, the metadata merge, and the durability reread.
   */
  function mappedReimbursementDeps(
    mappingMetadata: Record<string, unknown> | null
  ) {
    const mappingQuery = {
      selectAll: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({
        id: "mapping-1",
        entityId: "reimbursement-row-1",
        metadata: mappingMetadata
      })
    };
    const metadataUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined)
    };
    const documentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "reimbursement-row-1", reimbursementId: "REIMB-1" },
        error: null
      })
    };
    const normalizeAmount = vi
      .fn()
      .mockResolvedValue({ ok: true, value: 125.5 });
    const from = vi.fn().mockReturnValue(documentQuery);
    return {
      metadataUpdate,
      normalizeAmount,
      from,
      deps: {
        db: {
          selectFrom: vi.fn().mockReturnValue(mappingQuery),
          updateTable: vi.fn().mockReturnValue(metadataUpdate)
        },
        client: { from },
        companyId: "company-1",
        baseCurrency: "USD",
        reimbursementBankAccountId: "bank-1",
        normalizeAmount,
        getExchangeRate: vi.fn().mockResolvedValue(1),
        reimbursementDeepLinkUrl: (id: string) =>
          `https://carbon.example/x/reimbursements/${id}`
      } as unknown as RampReimbursementDependencies
    };
  }

  const reconfirmed = {
    ok: {
      id: "reimbursement-1",
      referenceId: "REIMB-1",
      deepLinkUrl: "https://carbon.example/x/reimbursements/reimbursement-row-1"
    }
  };

  it.each([
    "MANUALLY_REIMBURSED",
    "APPROVED",
    "AWAITING_PAYMENT",
    "AWAITING_PUSH_PAYMENT"
  ])("re-confirms an already-imported reimbursement in state %s without touching it", async (state) => {
    // Carbon owns the document once it lands. These states record no payout
    // intent, so a mapped item does no work at all beyond the reread.
    const { deps, metadataUpdate, normalizeAmount, from } =
      mappedReimbursementDeps(null);
    expect(
      await syncRampReimbursement(deps, { id: "reimbursement-1", state })
    ).toEqual(reconfirmed);
    expect(normalizeAmount).not.toHaveBeenCalled();
    expect(metadataUpdate.execute).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("reimbursement");
  });

  it.each([
    "REIMBURSED",
    "REIMBURSED_VIA_PUSH"
  ])("records the payout intent on an already-imported reimbursement Ramp has since PAID in state %s", async (state) => {
    // The document still is not touched — but the mapping must gain the
    // payout, or Post never creates the `payment`/`invoiceSettlement` and the
    // money Ramp moved is never settled in Carbon.
    const { deps, metadataUpdate } = mappedReimbursementDeps(null);
    expect(
      await syncRampReimbursement(deps, {
        id: "reimbursement-1",
        state,
        transaction_date: "2026-09-12",
        approved_at: "2026-09-13T10:00:00Z",
        entity_amount: { currency: "USD", value: 12550 }
      })
    ).toEqual(reconfirmed);
    expect(metadataUpdate.execute).toHaveBeenCalledTimes(1);
    expect(metadataUpdate.set).toHaveBeenCalledTimes(1);
    // The merge is a raw jsonb `||` fragment; its one parameter is the intent.
    const merged = metadataUpdate.set.mock.calls[0]?.[0] as {
      metadata: { toOperationNode: () => { parameters: unknown[] } };
    };
    const node = merged.metadata.toOperationNode();
    expect(node.parameters).toEqual([
      {
        kind: "ValueNode",
        value: JSON.stringify({
          rampPaymentId: "reimbursement-payment:reimbursement-1",
          paidAt: "2026-09-13",
          bankAccountId: "bank-1",
          amount: 125.5,
          currencyCode: "USD",
          exchangeRate: 1
        })
      }
    ]);
  });

  it("does not record a second payout intent on the next pass", async () => {
    // Idempotent, and the FIRST intent wins: it carries the FX snapshot of the
    // payout that actually happened.
    const { deps, metadataUpdate, normalizeAmount } = mappedReimbursementDeps({
      rampPaymentId: "reimbursement-payment:reimbursement-1",
      exchangeRate: 0.91
    });
    expect(
      await syncRampReimbursement(deps, {
        id: "reimbursement-1",
        state: "REIMBURSED",
        transaction_date: "2026-09-12",
        entity_amount: { currency: "USD", value: 12550 }
      })
    ).toEqual(reconfirmed);
    expect(metadataUpdate.execute).not.toHaveBeenCalled();
    expect(normalizeAmount).not.toHaveBeenCalled();
  });

  it("fails a PAID reimbursement whose payout intent cannot be built", async () => {
    // Ramp has already paid the employee, so an unrecordable payout is the
    // operator's problem to see — not something to confirm away silently.
    const { deps, metadataUpdate } = mappedReimbursementDeps(null);
    expect(
      await syncRampReimbursement(deps, {
        id: "reimbursement-1",
        state: "REIMBURSED",
        entity_amount: { currency: "USD", value: 12550 }
      })
    ).toEqual({
      fail: {
        id: "reimbursement-1",
        message: expect.stringContaining("payment date")
      }
    });
    expect(metadataUpdate.execute).not.toHaveBeenCalled();
  });

  it("continues original transaction resolution for documented ach repayments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getEntityId = vi.fn().mockResolvedValue(null);
    const ctx = {
      companyId: "company-1",
      metadata: {
        sync: { pullReimbursements: true },
        statementBankAccountId: "bank-1"
      },
      mapping: { getEntityId }
    } as unknown as RampSyncContext;
    const ramp = {
      listRepayments: async function* () {
        yield [
          {
            id: "repayment-1",
            status: "REPAID",
            funding_method: "ach",
            original_transaction_id: "charge-1"
          }
        ];
      }
    } as unknown as RampClient;
    await syncRampRepayments(ctx, ramp, undefined, "card-1", null);
    expect(getEntityId).toHaveBeenCalledWith("ramp", "charge-1", "charge");
  });

  it.each([
    undefined,
    null,
    "",
    "NEW_PAYMENT_RAIL",
    "VENDOR_CREDIT",
    "PAID_MANUALLY",
    "UNSPECIFIED"
  ])("rejects unsupported bill payment method %s before any invoice lookup", async (payment_method) => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    const outcome = await syncRampBillPayment(
      { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
      { id: "bill-1" },
      { id: "payment-1", payment_method }
    );
    expect(outcome).toEqual({
      fail: {
        id: "payment-1",
        message: expect.stringContaining("payment method")
      }
    });
    expect(getMappedInvoiceId).not.toHaveBeenCalled();
  });

  it("skips one-time card delivery payments instead of posting bank payments", async () => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    expect(
      await syncRampBillPayment(
        { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
        { id: "bill-1" },
        { id: "payment-1", payment_method: "ONE_TIME_CARD_DELIVERY" }
      )
    ).toEqual({ skip: { id: "payment-1", referenceId: "payment-1" } });
    expect(getMappedInvoiceId).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "",
    "NEW_STATE",
    "PAID",
    "PAID_OUT",
    "REJECTED",
    "DELETED"
  ])("rejects unsupported reimbursement state %s before any invoice lookup", async (state) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    };
    const selectFrom = vi.fn().mockReturnValue(query);
    const outcome = await syncRampReimbursement(
      {
        db: { selectFrom },
        companyId: "company-1"
      } as unknown as RampReimbursementDependencies,
      { id: "reimbursement-1", state }
    );
    expect(outcome).toEqual({
      fail: {
        id: "reimbursement-1",
        message: expect.stringContaining("reimbursement state")
      }
    });
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    "",
    "NEW_FUNDING",
    "STATEMENT_CREDIT"
  ])("rejects unverified repayment funding %s before any transaction lookup", async (funding_method) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getEntityId = vi.fn().mockResolvedValue(null);
    const ctx = {
      companyId: "company-1",
      metadata: {
        sync: { pullReimbursements: true },
        statementBankAccountId: "bank-1"
      },
      mapping: { getEntityId }
    } as unknown as RampSyncContext;
    const ramp = {
      listRepayments: async function* () {
        yield [
          {
            id: "repayment-1",
            status: "REPAID",
            funding_method,
            original_transaction_id: "charge-1"
          }
        ];
      }
    } as unknown as RampClient;
    expect(
      await syncRampRepayments(ctx, ramp, undefined, "card-1", null)
    ).toMatchObject({ created: 0, failed: 1 });
    expect(getEntityId).not.toHaveBeenCalled();
  });
});
