import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { PanelProvider } from "~/components/Layout/Panels";
import {
  getWarehouseTransfer,
  getWarehouseTransferLines,
} from "~/modules/inventory";
import WarehouseTransferHeader from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransferHeader";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Warehouse Transfer",
  to: path.to.warehouseTransfers,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });

  const { transferId } = params;
  if (!transferId) throw new Response("Not found", { status: 404 });

  const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
    getWarehouseTransfer(client, transferId),
    getWarehouseTransferLines(client, transferId),
  ]);

  if (warehouseTransfer.error) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(warehouseTransfer.error, "Failed to load warehouse transfer")
      )
    );
  }

  if (warehouseTransferLines.error) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(
          warehouseTransferLines.error,
          "Failed to load warehouse transfer lines"
        )
      )
    );
  }

  return json({
    warehouseTransfer: warehouseTransfer.data,
    warehouseTransferLines: warehouseTransferLines.data ?? [],
  });
}

export default function WarehouseTransferRoute() {
  const { warehouseTransfer } = useLoaderData<typeof loader>();
  const params = useParams();
  const { transferId } = params;
  if (!transferId) throw new Error("Could not find transferId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <WarehouseTransferHeader warehouseTransfer={warehouseTransfer} />
        <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
          <VStack
            spacing={4}
            className="h-full p-2 w-full max-w-5xl mx-auto pb-32"
          >
            <Outlet />
          </VStack>
        </div>
      </div>
    </PanelProvider>
  );
}
