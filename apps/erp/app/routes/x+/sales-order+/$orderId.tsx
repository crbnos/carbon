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
  getSalesOrderInvoicePaymentsByIds,
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

  if (opportunity.error) {
    throw new Error(
      `Failed to get opportunity record for sales order ${orderId} (opportunityId: ${
        salesOrder.data?.opportunityId ?? "null"
      }): ${opportunity.error.message}`
    );
  }

  if (!salesOrder.data?.opportunityId) {
    throw new Error(
      `Sales order ${orderId} has no opportunityId; the opportunity record is missing`
    );
  }

  if (!opportunity.data) {
    throw new Error(
      `No opportunity found with id ${salesOrder.data.opportunityId} referenced by sales order ${orderId}`
    );
  }

  const serviceRole = getCarbonServiceRole();
  const [quote, customer, companySettings, invoiceLines] = await Promise.all([
    opportunity.data.quotes[0]?.id
      ? getQuote(client, opportunity.data.quotes[0].id)
      : Promise.resolve(null),
    salesOrder.data?.customerId
      ? getCustomer(client, salesOrder.data.customerId)
      : Promise.resolve(null),
    getCompanySettings(serviceRole, companyId),
    getSalesOrderInvoiceLines(client, orderId)
  ]);

  if (invoiceLines.error) {
    throw redirect(
      path.to.salesOrder(orderId),
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
  let currencyMismatchCount = 0;

  if (invoiceIds.length > 0) {
    const [invoices, payments] = await Promise.all([
      getSalesOrderInvoicesByIds(client, invoiceIds),
      getSalesOrderInvoicePaymentsByIds(client, companyId, invoiceIds)
    ]);

    if (invoices.error) {
      throw redirect(
        path.to.salesOrder(orderId),
        await flash(
          request,
          error(invoices.error, "Failed to load sales invoice totals")
        )
      );
    }

    if (payments.error) {
      throw redirect(
        path.to.salesOrder(orderId),
        await flash(
          request,
          error(payments.error, "Failed to load sales invoice payments")
        )
      );
    }

    const paidByInvoiceId = new Map<string, number>();
    for (const payment of payments.data ?? []) {
      if (!payment.targetSalesInvoiceId) continue;
      paidByInvoiceId.set(
        payment.targetSalesInvoiceId,
        (paidByInvoiceId.get(payment.targetSalesInvoiceId) ?? 0) +
          (payment.sourceAmount ?? 0)
      );
    }

    const orderCurrency = salesOrder.data?.currencyCode;

    for (const invoice of invoices.data ?? []) {
      // A voided invoice was never billed — it must not inflate the invoiced
      // total, nor contribute any payments to the paid total.
      if (invoice.status === "Voided") {
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

      const invoiceTotalInOrderCurrency =
        invoiceTotal * (invoice.exchangeRate ?? 1);
      invoicedAmount += invoiceTotalInOrderCurrency;
      if (invoice.baseStatus === "Paid") {
        paidAmount += invoiceTotalInOrderCurrency;
      } else if (invoice.id) {
        paidAmount += paidByInvoiceId.get(invoice.id) ?? 0;
      }
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
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <SalesOrderHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SalesOrderExplorer />}
              content={
                <div className="bg-muted dark:bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
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
