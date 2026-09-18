import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader as purchaseLoader } from "~/routes/x+/purchase-invoice+/$invoiceId";
import { loader as orderLoader } from "~/routes/x+/purchase-order+/$orderId";
import { loader as salesLoader } from "~/routes/x+/sales-invoice+/$invoiceId";
import { getInvoicePaidAmounts } from "./invoicing.service";

vi.mock("@carbon/auth", () => ({
  error: (_: unknown, message: string) => message
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn(async () => ({
    client: {},
    companyId: "co",
    companyGroupId: "group"
  }))
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));
vi.mock("@carbon/ee/accounting", () => ({}));
vi.mock("@carbon/react", () => ({ VStack: () => null }));
vi.mock("@carbon/documents/email", () => ({}));
vi.mock("@carbon/documents/pdf", () => ({}));
vi.mock("@carbon/form", () => ({}));
vi.mock("@carbon/jobs", () => ({}));
vi.mock("@carbon/logger", () => ({ getLogger: () => ({}) }));
vi.mock("@carbon/notifications", () => ({}));
vi.mock("@react-email/components", () => ({}));
vi.mock("@lingui/core/macro", () => ({ msg: () => ({ id: "test" }) }));
vi.mock("~/components/Layout", () => ({}));
vi.mock("~/components/Layout/Panels", () => ({}));
vi.mock("~/modules/invoicing/stripe-customer.server", () => ({}));
vi.mock("~/services/database.server", () => ({}));
vi.mock("~/utils/handle", () => ({ detailBreadcrumb: () => undefined }));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));
vi.mock("~/modules/accounting", () => ({
  getCurrencyByCode: async () => ({ data: null })
}));
vi.mock("~/modules/documents", () => ({}));
vi.mock("~/modules/shared", () => ({}));
vi.mock("~/modules/users/users.server", () => ({}));
vi.mock("~/routes/file+/purchase-order+/$orderId[.]pdf", () => ({}));
vi.mock("~/modules/settings", () => ({
  getCompanySettings: async () => ({ data: {} })
}));
vi.mock("~/modules/sales/sales.service", () => ({
  getOpportunityDocuments: async () => [],
  getOpportunity: async () => ({ data: {} })
}));
vi.mock("~/modules/purchasing", () => ({
  getPurchaseOrder: async () => ({
    data: { id: "order", companyId: "co", currencyCode: "USD" },
    error: null
  }),
  getPurchaseOrderLines: async () => ({ data: [], error: null }),
  getPurchaseOrderDelivery: async () => ({ data: {}, error: null }),
  getSupplierInteraction: async () => ({ data: {} }),
  getSupplierInteractionDocuments: async () => [],
  getDefaultAttachmentsForPO: async () => [],
  getPurchaseOrderInvoiceLines: async () => ({
    data: [{ invoiceId: "invoice" }],
    error: null
  }),
  getPurchaseOrderInvoicesByIds: async () => ({
    data: [
      {
        id: "invoice",
        orderTotal: 100,
        balance: 0,
        status: "Paid",
        currencyCode: "USD"
      }
    ],
    error: null
  })
}));
vi.mock("~/modules/purchasing/ui/PurchaseOrder", () => ({}));
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer", () => ({
  default: () => null
}));
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader", () => ({
  default: () => null
}));
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceProperties", () => ({
  default: () => null
}));
vi.mock(
  "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer",
  () => ({ default: () => null })
);
vi.mock(
  "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceProperties",
  () => ({ default: () => null })
);
vi.mock("./invoicing.service", () => ({ getInvoicePaidAmounts: vi.fn() }));
vi.mock("~/modules/invoicing", async () => ({
  ...(await import("./invoicing.models")),
  ...(await import("./invoicing.service")),
  getCompanyHasOpenCredits: async () => false,
  getSalesInvoice: async () => ({
    data: { invoiceTotal: 100, balance: 0, status: "Paid" },
    error: null
  }),
  getSalesInvoiceLines: async () => ({ data: [] }),
  getSalesInvoiceShipment: async () => ({ data: {} }),
  getPurchaseInvoice: async () => ({
    data: { invoiceTotal: 100, balance: 0, status: "Paid" },
    error: null
  }),
  getPurchaseInvoiceLines: async () => ({ data: [] }),
  getPurchaseInvoiceDelivery: async () => ({ data: {} })
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getInvoicePaidAmounts).mockResolvedValue({ data: {}, error: null });
});

describe("invoice summary loader cash totals", () => {
  it.each([
    ["sales", salesLoader],
    ["purchase", purchaseLoader]
  ] as const)("%s invoice does not treat a credit-only settled balance as cash", async (side, loader) => {
    const result = await loader({
      request: new Request("http://test/invoice"),
      params: { invoiceId: "invoice" },
      context: {}
    } as unknown as Parameters<typeof loader>[0]);
    expect(result.invoicePaidAmount).toBe(0);
    expect(getInvoicePaidAmounts).toHaveBeenCalledWith({}, "co", side, [
      "invoice"
    ]);
  });
  it("purchase order keeps credit relief out of Paid", async () => {
    const result = await orderLoader({
      request: new Request("http://test/order"),
      params: { orderId: "order" },
      context: {}
    } as unknown as Parameters<typeof orderLoader>[0]);
    expect(result.invoiceSummary).toEqual({
      invoicedAmount: 100,
      paidAmount: 0,
      balanceRemaining: 0,
      currencyMismatchCount: 0
    });
    expect(getInvoicePaidAmounts).toHaveBeenCalledWith({}, "co", "purchase", [
      "invoice"
    ]);
  });
});

vi.mock("~/modules/purchasing/purchasing.service", () => ({
  getSupplierInteraction: async () => ({ data: {} }),
  getSupplierInteractionDocuments: async () => []
}));
