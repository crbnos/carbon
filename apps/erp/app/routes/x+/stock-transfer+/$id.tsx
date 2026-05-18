import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider } from "~/components/Layout";
import { getStockTransfer, getStockTransferLines } from "~/modules/inventory";
import StockTransferHeader from "~/modules/inventory/ui/StockTransfers/StockTransferHeader";
import StockTransferLines from "~/modules/inventory/ui/StockTransfers/StockTransferLines";
import StockTransferNotes from "~/modules/inventory/ui/StockTransfers/StockTransferNotes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [stockTransfer, stockTransferLines] = await Promise.all([
    getStockTransfer(id),
    getStockTransferLines(id)
  ]);

  if (stockTransfer.error) {
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(stockTransfer.error, "Failed to load stockTransfer")
      )
    );
  }

  if (stockTransfer.data.companyId !== companyId) {
    throw redirect(path.to.stockTransfers);
  }

  return {
    stockTransfer: stockTransfer.data,
    stockTransferLines: stockTransferLines.data ?? []
  };
}

export default function StockTransferRoute() {
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { stockTransfer } = useLoaderData<typeof loader>();

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <StockTransferHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
          <VStack spacing={4} className="h-full p-4 w-full max-w-5xl mx-auto">
            <StockTransferLines />
            <StockTransferNotes
              id={id}
              notes={(stockTransfer?.notes ?? {}) as JSONContent}
            />
          </VStack>
        </div>
      </div>
      <Outlet />
    </PanelProvider>
  );
}
