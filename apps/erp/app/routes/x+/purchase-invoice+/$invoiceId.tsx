import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getPurchaseInvoice,
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLines,
  PurchaseInvoiceHeader
} from "~/modules/invoicing";
import PurchaseInvoiceExplorer from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer";
import PurchaseInvoiceProperties from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceProperties";
import {
  getSupplier,
  getSupplierInteraction,
  getSupplierInteractionDocuments
} from "~/modules/purchasing/purchasing.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Invoices`,
  to: path.to.purchaseInvoices
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [purchaseInvoice, purchaseInvoiceLines, purchaseInvoiceDelivery] =
    await Promise.all([
      getPurchaseInvoice(client, invoiceId),
      getPurchaseInvoiceLines(client, invoiceId),
      getPurchaseInvoiceDelivery(client, invoiceId)
    ]);

  if (purchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoices,
      await flash(
        request,
        error(purchaseInvoice.error, "Failed to load purchase invoice")
      )
    );
  }

  const [supplier, interaction, files] = await Promise.all([
    purchaseInvoice.data?.supplierId
      ? getSupplier(client, purchaseInvoice.data.supplierId)
      : null,
    getSupplierInteraction(client, purchaseInvoice.data.supplierInteractionId!),
    getSupplierInteractionDocuments(
      client,
      companyId,
      purchaseInvoice.data.supplierInteractionId!
    )
  ]);

  return {
    purchaseInvoice: purchaseInvoice.data,
    purchaseInvoiceLines: purchaseInvoiceLines.data ?? [],
    purchaseInvoiceDelivery: purchaseInvoiceDelivery.data,
    files,
    interaction: interaction.data,
    supplier: supplier?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(
    request.headers.get("Referer") ?? new URL(request.url).pathname
  );
}

export default function PurchaseInvoiceRoute() {
  const params = useParams();
  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PurchaseInvoiceHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<PurchaseInvoiceExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<PurchaseInvoiceProperties key={invoiceId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
