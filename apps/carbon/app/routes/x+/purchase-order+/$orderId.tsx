import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { useEffect } from "react";
import {
  getPurchaseOrder,
  getPurchaseOrderExternalDocuments,
  getPurchaseOrderInternalDocuments,
  getPurchaseOrderLines,
} from "~/modules/purchasing";
import {
  PurchaseOrderHeader,
  PurchaseOrderSidebar,
  usePurchaseOrderTotals,
} from "~/modules/purchasing/ui/PurchaseOrder";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.purchaseOrders,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true,
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrder, purchaseOrderLines] = await Promise.all([
    getPurchaseOrder(client, orderId),
    getPurchaseOrderLines(client, orderId),
  ]);

  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order summary")
      )
    );
  }

  if (companyId !== purchaseOrder.data?.companyId) {
    throw redirect(path.to.purchaseOrders);
  }

  return defer({
    purchaseOrder: purchaseOrder.data,
    purchaseOrderLines: purchaseOrderLines.data ?? [],
    externalDocuments: getPurchaseOrderExternalDocuments(
      client,
      companyId,
      orderId
    ),
    internalDocuments: getPurchaseOrderInternalDocuments(
      client,
      companyId,
      orderId
    ),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(request.headers.get("Referer") ?? request.url);
}

export default function PurchaseOrderRoute() {
  const { purchaseOrderLines } = useLoaderData<typeof loader>();
  const [, setPurchaseOrderTotals] = usePurchaseOrderTotals();

  useEffect(() => {
    const totals = purchaseOrderLines.reduce(
      (acc, line) => {
        acc.total += (line.purchaseQuantity ?? 0) * (line.unitPrice ?? 0);

        return acc;
      },
      { total: 0 }
    );
    setPurchaseOrderTotals(totals);
  }, [purchaseOrderLines, setPurchaseOrderTotals]);

  return (
    <>
      <PurchaseOrderHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <PurchaseOrderSidebar />
        <Outlet />
      </div>
    </>
  );
}
