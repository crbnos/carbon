import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  PurchaseInvoiceHeader,
  getPurchaseInvoice,
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLines,
} from "~/modules/invoicing";
import PurchaseInvoiceExplorer from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer";
import PurchaseInvoiceProperties from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceProperties";
import {
  getSupplier,
  getSupplierInteraction,
  getSupplierInteractionDocuments,
} from "~/modules/purchasing/purchasing.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Purchase Invoices",
  to: path.to.purchaseInvoices,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [purchaseInvoice, purchaseInvoiceLines, purchaseInvoiceDelivery] =
    await Promise.all([
      getPurchaseInvoice(client, invoiceId),
      getPurchaseInvoiceLines(client, invoiceId),
      getPurchaseInvoiceDelivery(client, invoiceId),
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

  const [supplier, interaction] = await Promise.all([
    purchaseInvoice.data?.supplierId
      ? getSupplier(client, purchaseInvoice.data.supplierId)
      : null,
    getSupplierInteraction(client, purchaseInvoice.data.supplierInteractionId!),
  ]);

  return defer({
    purchaseInvoice: purchaseInvoice.data,
    purchaseInvoiceLines: purchaseInvoiceLines.data ?? [],
    purchaseInvoiceDelivery: purchaseInvoiceDelivery.data,
    files: getSupplierInteractionDocuments(
      client,
      companyId,
      purchaseInvoice.data.supplierInteractionId!
    ),
    interaction: interaction.data,
    supplier: supplier?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(request.headers.get("Referer") ?? request.url);
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
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanels
                  explorer={<PurchaseInvoiceExplorer />}
                  content={
                    <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                      <VStack spacing={2} className="p-2">
                        <Outlet />
                      </VStack>
                    </div>
                  }
                  properties={<PurchaseInvoiceProperties />}
                />
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
