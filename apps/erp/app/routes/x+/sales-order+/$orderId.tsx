import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments,
  getQuote,
  getSalesOrder,
  getSalesOrderInvoiceLines,
  getSalesOrderInvoicesByIds,
  getSalesOrderLines,
  getSalesOrderRelatedItems
} from "~/modules/sales";
import {
  SalesOrderExplorer,
  SalesOrderHeader,
  SalesOrderProperties
} from "~/modules/sales/ui/SalesOrder";
import { getCompanySettings } from "~/modules/settings";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Orders`, to: path.to.salesOrders },
    (data) => data?.salesOrder?.salesOrderId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [salesOrder, lines] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderLines(client, orderId)
  ]);

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  const opportunity = await getOpportunity(
    client,
    salesOrder.data?.opportunityId ?? null
  );

  if (companyId !== salesOrder.data?.companyId) {
    throw redirect(path.to.salesOrders);
  }

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  const serviceRole = getCarbonServiceRole();
  const [quote, customer, companySettings, invoiceLines] = await Promise.all([
    opportunity.data.quotes[0]?.id
      ? getQuote(client, opportunity.data.quotes[0].id)
      : Promise.resolve(null),
    salesOrder.data?.customerId
      ? getCustomer(client, salesOrder.data.customerId)
      : Promise.resolve(null),
    getCompanySettings(serviceRole, companyId),
    getSalesOrderInvoiceLines(client, orderId, companyId)
  ]);

  if (invoiceLines.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(invoiceLines.error, "Failed to load linked sales invoices")
      )
    );
  }

  const invoiceIds = Array.from(
    new Set(
      (invoiceLines.data ?? []).map((line) => line.invoiceId).filter(Boolean)
    )
  ) as string[];

  let invoicedAmount = 0;
  let paidAmount = 0;
  let balanceRemaining = 0;
  let currencyMismatchCount = 0;

  if (invoiceIds.length > 0) {
    const invoices = await getSalesOrderInvoicesByIds(
      client,
      invoiceIds,
      companyId
    );

    if (invoices.error) {
      throw redirect(
        path.to.salesOrders,
        await flash(
          request,
          error(invoices.error, "Failed to load sales invoice totals")
        )
      );
    }

    const orderCurrency = salesOrder.data?.currencyCode;
    // Draft/Pending are unposted; Voided/Return are non-revenue. Match the
    // invoice-view statuses that keep their stored (non-derived) values.
    const nonPostedStatuses = new Set(["Draft", "Pending", "Voided", "Return"]);

    for (const invoice of invoices.data ?? []) {
      if (nonPostedStatuses.has(invoice.status ?? "")) {
        continue;
      }

      const invoiceTotal = invoice.invoiceTotal ?? 0;
      const invoiceCurrency = invoice.currencyCode;

      // Avoid mixing currencies in the same displayed number.
      if (
        orderCurrency &&
        invoiceCurrency &&
        invoiceCurrency !== orderCurrency
      ) {
        currencyMismatchCount += 1;
        continue;
      }

      // Paid = settled amount on the invoice (total − open balance). Using the
      // view balance captures partial payments; the prior status==="Paid" gate
      // only counted fully-settled invoices.
      const openBalance = Math.max(0, Number(invoice.balance ?? invoiceTotal));
      const settled = Math.max(0, invoiceTotal - openBalance);

      invoicedAmount += invoiceTotal;
      paidAmount += settled;
      balanceRemaining += openBalance;
    }
  }

  const defaultCc = customer?.data?.defaultCc?.length
    ? customer.data.defaultCc
    : (companySettings.data?.defaultCustomerCc ?? []);

  return {
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: getOpportunityDocuments(client, companyId, opportunity.data.id),
    relatedItems: getSalesOrderRelatedItems(
      client,
      orderId,
      opportunity.data.id
    ),
    opportunity: opportunity.data,
    customer: customer?.data ?? null,
    quote: quote?.data ?? null,
    invoiceSummary: {
      invoicedAmount,
      paidAmount,
      balanceRemaining,
      currencyMismatchCount
    },
    originatedFromQuote: !!opportunity.data.quotes[0]?.id,
    defaultCc
  };
}

export default function SalesOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <SalesOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SalesOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<SalesOrderProperties key={orderId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
