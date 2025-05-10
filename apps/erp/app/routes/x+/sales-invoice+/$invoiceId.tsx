import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getSalesInvoice,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
} from "~/modules/invoicing";
import SalesInvoiceExplorer from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer";
import SalesInvoiceHeader from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader";
import SalesInvoiceProperties from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceProperties";

import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments,
} from "~/modules/sales/sales.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Sales Invoices",
  to: path.to.salesInvoices,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
    await Promise.all([
      getSalesInvoice(client, invoiceId),
      getSalesInvoiceLines(client, invoiceId),
      getSalesInvoiceShipment(client, invoiceId),
    ]);

  if (salesInvoice.error) {
    throw redirect(
      path.to.salesInvoices,
      await flash(
        request,
        error(salesInvoice.error, "Failed to load sales invoice")
      )
    );
  }

  const [customer, opportunity] = await Promise.all([
    salesInvoice.data?.customerId
      ? getCustomer(client, salesInvoice.data.customerId)
      : null,
    salesInvoice.data?.opportunityId
      ? getOpportunity(client, salesInvoice.data.opportunityId)
      : null,
  ]);

  return defer({
    salesInvoice: salesInvoice.data,
    salesInvoiceLines: salesInvoiceLines.data ?? [],
    salesInvoiceShipment: salesInvoiceShipment.data,
    files: getOpportunityDocuments(
      client,
      companyId,
      salesInvoice.data?.opportunityId!
    ),
    opportunity: opportunity?.data ?? null,
    customer: customer?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(request.headers.get("Referer") ?? request.url);
}

export default function SalesInvoiceRoute() {
  const params = useParams();
  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <SalesInvoiceHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SalesInvoiceExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<SalesInvoiceProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
