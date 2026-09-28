import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>,
  credits: vi.fn(),
  sales: vi.fn(),
  purchase: vi.fn(),
  funding: vi.fn(),
  staged: vi.fn()
}));
vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn(),
  notFound: vi.fn(),
  success: vi.fn()
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn(async () => ({
    client: "client",
    companyId: "company"
  }))
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/form", () => ({
  validationError: vi.fn(),
  validator: vi.fn()
}));
vi.mock("@carbon/react", () => ({ VStack: vi.fn() }));
vi.mock("~/utils/handle", () => ({ detailBreadcrumb: vi.fn() }));
vi.mock("~/utils/form", () => ({ setCustomFields: vi.fn() }));
vi.mock("~/utils/path", () => ({
  path: { to: { payments: "/x/invoicing/payments" } }
}));
vi.mock("~/modules/invoicing", () => ({
  getPayment: vi.fn(async () => ({ data: h.payment, error: null })),
  getInvoiceSettlements: vi.fn(async () => ({ data: [], error: null })),
  getPaymentCurrencyConfiguration: vi.fn(async () => ({
    baseCurrencyCode: "USD",
    currencyDecimals: 2
  })),
  getAvailableCreditsForParty: h.credits,
  getOpenSalesInvoicesForCustomer: h.sales,
  getOpenPurchaseInvoicesForSupplier: h.purchase,
  getAvailableOnAccountCreditSources: h.funding,
  getStagedCreditsForPayment: h.staged,
  isPaymentLocked: vi.fn(),
  PaymentApplications: vi.fn(),
  PaymentApplyTable: vi.fn(),
  PaymentForm: vi.fn(),
  AvailableCreditsTable: vi.fn(),
  paymentValidator: {},
  upsertPayment: vi.fn()
}));

import { loader } from "./$paymentId";

beforeEach(() => {
  vi.clearAllMocks();
  h.payment = {
    id: "refund",
    status: "Draft",
    currencyCode: "EUR",
    customerId: null,
    supplierId: null
  };
  h.credits.mockResolvedValue({
    data: [
      {
        id: "memo",
        memoId: "CM1",
        currencyCode: "EUR",
        exchangeRate: 1.1,
        amount: 50,
        remaining: 40,
        remainingDocument: 44
      }
    ],
    error: null
  });
  h.sales.mockResolvedValue({ data: [], error: null });
  h.purchase.mockResolvedValue({ data: [], error: null });
  h.funding.mockResolvedValue({
    data: { sources: [], availableDocumentAmount: 0, availableBaseAmount: 0 },
    error: null
  });
  h.staged.mockResolvedValue({ data: [], error: null });
});
it.each([
  ["Disbursement", "customerId", "sales"],
  ["Receipt", "supplierId", "purchase"]
])("loads memo refund targets for %s %s", async (paymentType, partyKey, side) => {
  h.payment = { ...h.payment, paymentType, [partyKey]: "party" };
  const result = await loader({
    request: new Request("http://localhost/x/payments/refund"),
    params: { paymentId: "refund" },
    context: {}
  } as never);
  expect(result.openInvoices).toEqual([
    expect.objectContaining({
      id: "memo",
      invoiceId: "CM1",
      balance: 40,
      remainingDocument: 44
    })
  ]);
  expect(h.credits).toHaveBeenCalledWith(
    "client",
    "company",
    { side, [partyKey]: "party" },
    "refund",
    "EUR"
  );
  expect(h.sales).not.toHaveBeenCalled();
  expect(h.purchase).not.toHaveBeenCalled();
  expect(h.funding).not.toHaveBeenCalled();
  expect(h.staged).not.toHaveBeenCalled();
});
