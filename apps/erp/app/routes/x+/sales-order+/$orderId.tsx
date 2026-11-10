// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  type SalesOrderInvoiceSummary,
  summarizeSalesOrderInvoices
} from "~/modules/sales/sales.utils";
import {
  SalesOrderExplorer,
  SalesOrderHeader,
  SalesOrderProperties
} from "~/modules/sales/ui/SalesOrder";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  appBarSubtitle: msg`Sales Order`,
  realtime: [
    { table: "salesOrder", column: "id", param: "orderId" },
    { table: "salesOrderLine", column: "salesOrderId", param: "orderId" },
    {
      // Shipments and invoices made from this order carry its opportunity
      // (`getSalesOrderRelatedItems`, the convert function).
      table: "shipment",
      filter: ({ data }) =>
        data?.opportunity?.id
          ? `opportunityId=eq.${data.opportunity.id}`
          : undefined
    },
    {
      // Shipments and invoices made from this order carry its opportunity
      // (`getSalesOrderRelatedItems`, the convert function).
      table: "salesInvoice",
      filter: ({ data }) =>
        data?.opportunity?.id
          ? `opportunityId=eq.${data.opportunity.id}`
          : undefined
    }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Orders`, to: path.to.salesOrders },
    (data) => data?.salesOrder?.salesOrderId
  ),
  module: "sales"
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.salesOrder?.salesOrderId, "Sales Order");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, api } = await authorize(
    request,
    { "sales.salesOrders": "View" },
    { bypassRls: true }
  );

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  // Three steps at most: what needs only the order id is read with the order,
  // what needs the order's or the invoice lines' values follows together, and
  // the originating quote waits for the opportunity.
  const serviceRole = getCarbonServiceRole();
  const [salesOrder, lines, companySettings, invoiceLines] = await Promise.all([
    api.sales.getSalesOrder({ salesOrderId: orderId }),
    api.sales.getSalesOrderLines({ salesOrderId: orderId }),
    getCompanySettings(serviceRole, companyId),
    api.sales.getSalesOrderInvoiceLines({ salesOrderId: orderId })
  ]);

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  if (companyId !== salesOrder.data?.companyId) {
    throw redirect(path.to.salesOrders);
  }

  const invoiceIds = Array.from(
    new Set(
      (invoiceLines.data ?? []).map((line) => line.invoiceId).filter(Boolean)
    )
  ) as string[];

  const [opportunity, customer, invoices, payments] = await Promise.all([
    api.sales.getOpportunity({
      opportunityId: salesOrder.data?.opportunityId ?? null
    }),
    salesOrder.data?.customerId
      ? api.sales.getCustomer({ customerId: salesOrder.data.customerId })
      : null,
    invoiceIds.length > 0
      ? api.sales.getSalesOrderInvoicesByIds({ invoiceIds })
      : null,
    invoiceIds.length > 0
      ? api.sales.getSalesOrderInvoicePaymentsByIds({ invoiceIds })
      : null
  ]);

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

  if (invoiceLines.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(invoiceLines.error, "Failed to load linked sales invoices")
      )
    );
  }

  const quote = opportunity.data.quotes[0]?.id
    ? await api.sales.getQuote({ quoteId: opportunity.data.quotes[0].id })
    : null;

  let invoiceSummary: SalesOrderInvoiceSummary = {
    invoicedAmount: 0,
    paidAmount: 0,
    currencyMismatchCount: 0
  };

  if (invoices && payments) {
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

    invoiceSummary = summarizeSalesOrderInvoices(
      salesOrder.data?.currencyCode,
      invoices.data ?? [],
      payments.data ?? []
    );
  }

  const defaultCc = customer?.data?.defaultCc?.length
    ? customer.data.defaultCc
    : (companySettings.data?.defaultCustomerCc ?? []);

  return {
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: api.sales
      .getOpportunityDocuments({ opportunityId: opportunity.data.id })
      .then(dataOrThrow),
    relatedItems: api.sales
      .getSalesOrderRelatedItems({
        salesOrderId: orderId,
        opportunityId: opportunity.data.id
      })
      .then(dataOrThrow),
    opportunity: opportunity.data,
    customer: customer?.data ?? null,
    quote: quote?.data ?? null,
    invoiceSummary,
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
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
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
