import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { createMappingService } from "@carbon/ee/accounting";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getCompanyHasOpenCredits,
  getSalesInvoice,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing";
import { STRIPE_CONNECT_INTEGRATION } from "~/modules/invoicing/stripe-customer.server";
import SalesInvoiceExplorer from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer";
import SalesInvoiceHeader from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader";
import SalesInvoiceProperties from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceProperties";
import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments
} from "~/modules/sales/sales.service";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Sales Invoices`, to: path.to.invoicingSales },
    (data) => data?.salesInvoice?.invoiceId
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "invoicing"
    }
  );

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
    await Promise.all([
      getSalesInvoice(client, invoiceId),
      getSalesInvoiceLines(client, invoiceId),
      getSalesInvoiceShipment(client, invoiceId)
    ]);

  if (salesInvoice.error) {
    throw redirect(
      path.to.invoicingSales,
      await flash(
        request,
        error(salesInvoice.error, "Failed to load sales invoice")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  const [customer, opportunity, companySettings, orgHasCredits, currency] =
    await Promise.all([
      salesInvoice.data?.customerId
        ? getCustomer(client, salesInvoice.data.customerId)
        : null,
      salesInvoice.data?.opportunityId
        ? getOpportunity(client, salesInvoice.data.opportunityId)
        : null,
      getCompanySettings(serviceRole, companyId),
      getCompanyHasOpenCredits(client, companyId, "sales"),
      salesInvoice.data?.currencyCode
        ? getCurrencyByCode(
            serviceRole,
            companyGroupId,
            salesInvoice.data.currencyCode
          )
        : null
    ]);

  const defaultCc = customer?.data?.defaultCc?.length
    ? customer.data.defaultCc
    : (companySettings.data?.defaultCustomerCc ?? []);

  // Fetch Stripe invoice URL if this invoice was posted via Stripe
  let stripeInvoiceUrl: string | null = null;
  if (salesInvoice.data?.postingDate) {
    const mappingService = createMappingService(getDatabaseClient(), companyId);
    const mapping = await mappingService.getByEntity(
      "salesInvoice",
      invoiceId,
      STRIPE_CONNECT_INTEGRATION
    );
    if (mapping?.metadata) {
      const metadata = mapping.metadata as Record<string, unknown> | undefined;
      stripeInvoiceUrl =
        (metadata?.hostedInvoiceUrl as string | undefined) ?? null;
    }
  }

  return {
    salesInvoice: salesInvoice.data,
    currency: currency?.data ?? null,
    salesInvoiceLines: salesInvoiceLines.data ?? [],
    salesInvoiceShipment: salesInvoiceShipment.data,
    files: getOpportunityDocuments(
      client,
      companyId,
      salesInvoice.data?.opportunityId!
    ),
    opportunity: opportunity?.data ?? null,
    customer: customer?.data ?? null,
    defaultCc,
    orgHasCredits,
    stripeInvoiceUrl
  };
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(
    request.headers.get("Referer") ?? new URL(request.url).pathname
  );
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
                  <VStack spacing={4} className="p-4">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<SalesInvoiceProperties key={invoiceId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
