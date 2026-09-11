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

  it.each([
    "REIMBURSED",
    "REIMBURSED_VIA_PUSH",
    "MANUALLY_REIMBURSED",
    "APPROVED",
    "AWAITING_PAYMENT",
    "AWAITING_PUSH_PAYMENT"
  ])("requires a settlement only for verified Ramp-paid state %s", async (state) => {
    const mappingQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ entityId: "invoice-1" })
    };
    const invoiceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "invoice-1",
          invoiceId: "PI-1",
          status: "Posted",
          currencyCode: "USD",
          exchangeRate: 1
        },
        error: null
      })
    };
    const normalizeAmount = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Payment amount required" });
    const outcome = await syncRampReimbursement(
      {
        db: { selectFrom: vi.fn().mockReturnValue(mappingQuery) },
        client: { from: vi.fn().mockReturnValue(invoiceQuery) },
        companyId: "company-1",
        normalizeAmount,
        invoiceDeepLinkUrl: () => "https://carbon.example/invoice-1"
      } as unknown as RampReimbursementDependencies,
      { id: "reimbursement-1", state }
    );
    if (state === "REIMBURSED" || state === "REIMBURSED_VIA_PUSH") {
      expect(outcome).toEqual({
        fail: { id: "reimbursement-1", message: "Payment amount required" }
      });
      expect(normalizeAmount).toHaveBeenCalledOnce();
    } else {
      expect(outcome).toHaveProperty("ok");
      expect(normalizeAmount).not.toHaveBeenCalled();
    }
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
    expect(getEntityId).toHaveBeenCalledWith(
      "ramp",
      "charge-1",
      "cardTransaction"
    );
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
