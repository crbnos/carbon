import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sales from "~/modules/sales";
import { getCompanySettings } from "~/modules/settings";
import { loader } from "./$orderId";

vi.mock("@carbon/auth", () => ({
  error: (cause: unknown, message: string) => ({ cause, message })
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/react", () => ({ VStack: () => null }));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("~/components/Layout/Panels", () => ({
  PanelProvider: () => null,
  ResizablePanels: () => null
}));
vi.mock("~/modules/sales/ui/SalesOrder", () => ({
  SalesOrderExplorer: () => null,
  SalesOrderHeader: () => null,
  SalesOrderProperties: () => null
}));
vi.mock("~/modules/settings", () => ({ getCompanySettings: vi.fn() }));
vi.mock("~/utils/handle", () => ({
  detailBreadcrumb: () => undefined
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      items: "/x/items",
      salesOrders: "/x/sales-orders",
      salesOrder: (id: string) => `/x/sales-order/${id}`
    }
  }
}));
vi.mock("~/modules/sales", () => ({
  getCustomer: vi.fn(),
  getOpportunity: vi.fn(),
  getOpportunityDocuments: vi.fn(),
  getQuote: vi.fn(),
  getSalesOrder: vi.fn(),
  getSalesOrderInvoiceLines: vi.fn(),
  getSalesOrderInvoicePaymentsByIds: vi.fn(),
  getSalesOrderInvoicesByIds: vi.fn(),
  getSalesOrderLines: vi.fn(),
  getSalesOrderRelatedItems: vi.fn()
}));

const getSalesOrderInvoicePaymentsByIds = vi.mocked(
  sales.getSalesOrderInvoicePaymentsByIds
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: {},
    companyId: "company-1"
  } as Awaited<ReturnType<typeof requirePermissions>>);
  vi.mocked(getCarbonServiceRole).mockReturnValue({} as never);
  vi.mocked(sales.getSalesOrder).mockResolvedValue({
    data: {
      id: "order-1",
      companyId: "company-1",
      opportunityId: "opportunity-1",
      customerId: "customer-1",
      currencyCode: "USD"
    },
    error: null
  } as never);
  vi.mocked(sales.getSalesOrderLines).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(sales.getOpportunity).mockResolvedValue({
    data: { id: "opportunity-1", quotes: [] },
    error: null
  } as never);
  vi.mocked(sales.getCustomer).mockResolvedValue({
    data: { defaultCc: [] },
    error: null
  } as never);
  vi.mocked(getCompanySettings).mockResolvedValue({
    data: { defaultCustomerCc: [] },
    error: null
  } as never);
  vi.mocked(sales.getSalesOrderInvoiceLines).mockResolvedValue({
    data: [{ invoiceId: "invoice-1" }],
    error: null
  } as never);
  vi.mocked(sales.getSalesOrderInvoicesByIds).mockResolvedValue({
    data: [
      {
        id: "invoice-1",
        invoiceTotal: 100,
        balance: 0,
        status: "Paid",
        currencyCode: "USD",
        exchangeRate: 1
      }
    ],
    error: null
  } as never);
  getSalesOrderInvoicePaymentsByIds.mockResolvedValue({
    data: [
      {
        targetSalesInvoiceId: "invoice-1",
        appliedAmount: 75,
        payment: { status: "Posted" }
      }
    ],
    count: 1,
    error: null
  });
  vi.mocked(sales.getOpportunityDocuments).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(sales.getSalesOrderRelatedItems).mockResolvedValue({
    data: [],
    error: null
  } as never);
});

describe("sales order invoice summary", () => {
  it("counts applied payment principal instead of discounts and write-offs", async () => {
    const result = await loader({
      request: new Request("http://localhost/x/sales-order/order-1"),
      params: { orderId: "order-1" },
      context: {}
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.invoiceSummary).toEqual({
      invoicedAmount: 100,
      paidAmount: 75,
      balanceRemaining: 0,
      currencyMismatchCount: 0
    });
  });

  it("keeps a credit-only invoice balance separate from cash paid", async () => {
    getSalesOrderInvoicePaymentsByIds.mockResolvedValue({
      data: [],
      count: 0,
      error: null
    });
    const result = await loader({
      request: new Request("http://localhost/x/sales-order/order-1"),
      params: { orderId: "order-1" },
      context: {}
    } as unknown as Parameters<typeof loader>[0]);
    expect(result.invoiceSummary).toEqual({
      invoicedAmount: 100,
      paidAmount: 0,
      balanceRemaining: 0,
      currencyMismatchCount: 0
    });
    expect(sales.getSalesOrderInvoicesByIds).toHaveBeenCalledWith(
      {},
      ["invoice-1"],
      "company-1"
    );
  });

  it("returns invoice and payment totals in the order currency", async () => {
    vi.mocked(sales.getSalesOrder).mockResolvedValue({
      data: {
        id: "order-1",
        companyId: "company-1",
        opportunityId: "opportunity-1",
        customerId: "customer-1",
        currencyCode: "EUR"
      },
      error: null
    } as never);
    vi.mocked(sales.getSalesOrderInvoicesByIds).mockResolvedValue({
      data: [
        {
          id: "invoice-1",
          invoiceTotal: 100,
          balance: 50,
          status: "Partially Paid",
          currencyCode: "EUR",
          exchangeRate: 0.8
        }
      ],
      error: null
    } as never);
    getSalesOrderInvoicePaymentsByIds.mockResolvedValue({
      data: [
        {
          targetSalesInvoiceId: "invoice-1",
          appliedAmount: 50,
          payment: { status: "Posted" }
        }
      ],
      count: 1,
      error: null
    });

    const result = await loader({
      request: new Request("http://localhost/x/sales-order/order-1"),
      params: { orderId: "order-1" },
      context: {}
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.invoiceSummary).toEqual({
      invoicedAmount: 80,
      paidAmount: 40,
      balanceRemaining: 40,
      currencyMismatchCount: 0
    });
  });
});
